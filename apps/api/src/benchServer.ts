import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DUPLICATE_WINDOW_MS, deriveAttendanceSessions, isDuplicateScan, meetingDateForTimestamp, type AttendanceSession, type KioskScanAcknowledgement, type KioskSyncRequest, type ScanEvent } from "@frc-attendance/shared";
import { sha256Hex } from "./auth";

const port = Number(process.env.PORT ?? "8787");
const dbPath = process.env.BENCH_DB_PATH ?? "./bench-api.sqlite";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let enrollmentInProgress = false;
let latestDisplayState: KioskDisplayState = {
  status: "ready",
  message: "Place finger on reader",
  detail: "Attendance kiosk ready",
  updatedAt: new Date().toISOString()
};
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS kiosks (
    kiosk_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS scan_events (
    id TEXT PRIMARY KEY,
    kiosk_id TEXT NOT NULL,
    local_event_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    synced_at TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    rejection_reason TEXT,
    UNIQUE(kiosk_id, local_event_id)
  );
`);

async function seedBenchData() {
  db.prepare(`
    INSERT INTO students (student_id, first_name, last_name, active)
    VALUES ('100001', 'Bench', 'Student', 1)
    ON CONFLICT(student_id) DO UPDATE SET active = 1
  `).run();

  db.prepare(`
    INSERT INTO kiosks (kiosk_id, token_hash, active)
    VALUES ('bench-01', ?, 1)
    ON CONFLICT(kiosk_id) DO UPDATE SET token_hash = excluded.token_hash, active = 1
  `).run(await sha256Hex("dev-token"));
}

await seedBenchData();

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, service: "bench-api" });
      return;
    }

    if (request.method === "GET" && request.url === "/kiosk/display-state") {
      sendJson(response, 200, currentDisplayState());
      return;
    }

    if (request.method === "POST" && request.url === "/kiosk/sync") {
      const kioskId = await requireKiosk(request.headers.authorization);
      const body = await readBody<KioskSyncRequest>(request);
      if (body.kioskId !== kioskId) throw httpError(403, "Kiosk token does not match kioskId");
      sendJson(response, 200, syncKioskEvents(kioskId, body));
      return;
    }

    if (request.method === "POST" && request.url === "/kiosk/display/no-match") {
      await requireKiosk(request.headers.authorization);
      setDisplayState({
        status: "unknown",
        message: "Fingerprint not recognized",
        detail: "Try again or ask a mentor for help."
      });
      sendJson(response, 200, latestDisplayState);
      return;
    }

    if (request.method === "GET" && request.url === "/bench/events") {
      const events = db.prepare("SELECT * FROM scan_events ORDER BY occurred_at DESC LIMIT 50").all();
      sendJson(response, 200, { events });
      return;
    }

    if (request.method === "GET" && request.url === "/admin/students") {
      const students = db.prepare("SELECT student_id, first_name, last_name, active FROM students ORDER BY last_name, first_name").all();
      sendJson(response, 200, { students });
      return;
    }

    if (request.method === "POST" && request.url === "/admin/roster/sync") {
      const body = await readBody<{ members: Array<{ memberId: string; firstName: string; lastName: string }> }>(request);
      const result = syncRoster(body.members);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/admin/fingerprint/enroll") {
      const body = await readBody<{ memberId: string; slot: number; fingerLabel?: string }>(request);
      const result = await enrollFingerprint(body);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/admin/kiosk-ui/restart") {
      await runCommand("systemctl", ["--user", "restart", "frc-kiosk-ui"]);
      sendJson(response, 200, { message: "Kiosk display service restarted. The kiosk screen should reconnect in a few seconds." });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/presence")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, buildPresenceReport(url.searchParams.get("date") ?? undefined));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/member")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, buildMemberAttendanceReport(requireNonEmptyString(url.searchParams.get("studentId") ?? undefined, "studentId")));
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: number }).status) : 500;
    sendJson(response, status, { error: error instanceof Error ? error.message : "Internal server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Bench API listening on http://localhost:${port}`);
  console.log(`Seeded student 100001, kiosk bench-01, token dev-token`);
});

async function requireKiosk(authHeader: string | undefined): Promise<string> {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) throw httpError(401, "Missing kiosk bearer token");
  const tokenHash = await sha256Hex(token);
  const row = db.prepare("SELECT kiosk_id FROM kiosks WHERE token_hash = ? AND active = 1").get(tokenHash) as { kiosk_id: string } | undefined;
  if (!row) throw httpError(401, "Invalid kiosk token");
  db.prepare("UPDATE kiosks SET last_seen_at = ? WHERE kiosk_id = ?").run(new Date().toISOString(), row.kiosk_id);
  return row.kiosk_id;
}

function syncRoster(members: Array<{ memberId: string; firstName: string; lastName: string }>) {
  const seen = new Set<string>();
  const upsert = db.prepare(`
    INSERT INTO students (student_id, first_name, last_name, active)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(student_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      active = 1
  `);

  const transaction = db.transaction(() => {
    for (const member of members) {
      seen.add(member.memberId);
      upsert.run(member.memberId, member.firstName, member.lastName);
    }
    if (members.length > 0) {
      const deactivateMissing = db.prepare(`UPDATE students SET active = 0 WHERE student_id NOT IN (${members.map(() => "?").join(",")})`);
      deactivateMissing.run(...members.map((member) => member.memberId));
    }
  });
  transaction();

  return { synced: seen.size, deactivatedMissingStudents: members.length > 0 };
}

async function enrollFingerprint(input: { memberId: string; slot: number; fingerLabel?: string }) {
  if (enrollmentInProgress) throw httpError(409, "Fingerprint enrollment is already in progress");

  const memberId = input.memberId?.trim();
  const slot = Number(input.slot);
  const fingerLabel = input.fingerLabel?.trim();
  if (!memberId) throw httpError(400, "memberId is required");
  if (!Number.isInteger(slot) || slot < 1 || slot > 200) throw httpError(400, "slot must be an integer from 1 to 200");

  const student = db.prepare("SELECT active FROM students WHERE student_id = ?").get(memberId) as { active: number } | undefined;
  if (!student?.active) throw httpError(400, "member is not active in roster");

  enrollmentInProgress = true;
  try {
    await runCommand("systemctl", ["--user", "stop", "frc-kiosk-service"]);
    const result = await runCommand("python3", [
      resolve(repoRoot, "apps/kiosk/enroll_fingerprint.py"),
      "--student-id",
      memberId,
      "--slot",
      String(slot),
      "--db",
      resolve(repoRoot, "apps/kiosk/kiosk-cache.sqlite"),
      "--port",
      "/dev/serial0",
      "--baudrate",
      "57600",
      ...(fingerLabel ? ["--finger-label", fingerLabel] : [])
    ], 180_000);

    return {
      memberId,
      slot,
      fingerLabel: fingerLabel || null,
      message: `Fingerprint linked to member ${memberId} in slot ${slot}. You can test it on the kiosk screen now.`,
      details: result.output.trim()
    };
  } finally {
    await runCommand("systemctl", ["--user", "start", "frc-kiosk-service"]).catch((error) => {
      console.error(`Could not restart kiosk service after enrollment: ${error instanceof Error ? error.message : String(error)}`);
    });
    enrollmentInProgress = false;
  }
}

function runCommand(command: string, args: string[], timeoutMs = 30_000): Promise<{ output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(httpError(504, `${command} timed out. ${output.trim()}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ output });
      else reject(httpError(500, `${command} exited with code ${code}. ${output.trim()}`));
    });
  });
}

function syncKioskEvents(kioskId: string, body: KioskSyncRequest) {
  const accepted: ScanEvent[] = [];
  const duplicates: ScanEvent[] = [];
  const rejected: Array<KioskSyncRequest["events"][number] & { reason: string }> = [];
  const acknowledgements: KioskScanAcknowledgement[] = [];
  const now = new Date().toISOString();

  for (const input of body.events) {
    const existing = db.prepare("SELECT * FROM scan_events WHERE kiosk_id = ? AND local_event_id = ?").get(kioskId, input.localEventId) as DbScanEvent | undefined;
    if (existing) {
      const event = rowToScanEvent(existing);
      if (event.status === "accepted") accepted.push(event);
      else if (event.status === "duplicate") duplicates.push(event);
      else rejected.push({ ...input, reason: existing.rejection_reason ?? "previously rejected" });
      acknowledgements.push(buildAcknowledgement(input, event.status, existing.rejection_reason ?? undefined));
      continue;
    }

    const student = db.prepare("SELECT active FROM students WHERE student_id = ?").get(input.studentId) as { active: number } | undefined;
    if (!student?.active) {
      rejected.push({ ...input, reason: "student is not active in roster" });
      insertScanEvent(kioskId, input, now, "rejected", "student is not active in roster");
      acknowledgements.push(buildAcknowledgement(input, "rejected", "student is not active in roster"));
      continue;
    }

    const previous = db.prepare("SELECT * FROM scan_events WHERE student_id = ? AND status = 'accepted' ORDER BY occurred_at DESC LIMIT 1").get(input.studentId) as DbScanEvent | undefined;
    if (isDuplicateScan(previous ? rowToScanEvent(previous) : undefined, input, DEFAULT_DUPLICATE_WINDOW_MS)) {
      const event = insertScanEvent(kioskId, input, now, "duplicate", "duplicate scan window");
      duplicates.push(event);
      acknowledgements.push(buildAcknowledgement(input, "duplicate", "duplicate scan window"));
      continue;
    }

    const event = insertScanEvent(kioskId, input, now, "accepted");
    accepted.push(event);
    acknowledgements.push(buildAcknowledgement(input, "accepted"));
  }

  const latest = acknowledgements[acknowledgements.length - 1];
  if (latest) setDisplayState(displayStateForAcknowledgement(latest));
  return { accepted, duplicates, rejected, acknowledgements };
}

function buildAcknowledgement(
  input: KioskSyncRequest["events"][number],
  status: "accepted" | "duplicate" | "rejected",
  reason?: string
): KioskScanAcknowledgement {
  const student = db.prepare("SELECT first_name, last_name FROM students WHERE student_id = ?").get(input.studentId) as { first_name: string; last_name: string } | undefined;
  const displayName = student ? `${student.first_name} ${student.last_name}` : undefined;

  if (status === "duplicate") {
    return {
      localEventId: input.localEventId,
      studentId: input.studentId,
      status,
      displayName,
      message: displayName ? `${displayName} was already recorded.` : "Scan was already recorded."
    };
  }

  if (status === "rejected") {
    return {
      localEventId: input.localEventId,
      studentId: input.studentId,
      status,
      displayName,
      message: reason === "student is not active in roster" ? "Member is not active in the roster." : "Scan could not be accepted."
    };
  }

  const action = nextAcceptedScanAction(input.studentId, input.occurredAt);
  return {
    localEventId: input.localEventId,
    studentId: input.studentId,
    status,
    displayName,
    action,
    message: action === "check_in" ? `Welcome, ${displayName ?? input.studentId}` : `Goodbye, ${displayName ?? input.studentId}`
  };
}

function nextAcceptedScanAction(studentId: string, occurredAt: string): "check_in" | "check_out" {
  const meetingDate = meetingDateForTimestamp(occurredAt);
  const count = db.prepare("SELECT COUNT(*) AS count FROM scan_events WHERE student_id = ? AND status = 'accepted' AND date(occurred_at) = ?").get(studentId, meetingDate) as { count: number };
  return count.count % 2 === 1 ? "check_in" : "check_out";
}

function displayStateForAcknowledgement(acknowledgement: KioskScanAcknowledgement): Omit<KioskDisplayState, "updatedAt"> {
  if (acknowledgement.status === "duplicate") {
    return {
      status: "duplicate",
      message: "Already recorded",
      detail: acknowledgement.displayName ?? `Member ${acknowledgement.studentId}`
    };
  }

  if (acknowledgement.status === "rejected") {
    return {
      status: "rejected",
      message: "Scan rejected",
      detail: acknowledgement.message
    };
  }

  return {
    status: acknowledgement.action === "check_out" ? "goodbye" : "welcome",
    message: acknowledgement.action === "check_out" ? "Goodbye" : "Welcome",
    detail: acknowledgement.displayName ?? `Member ${acknowledgement.studentId}`
  };
}

function buildPresenceReport(date = meetingDateForTimestamp(new Date().toISOString())) {
  const students = db.prepare(
    "SELECT student_id, first_name, last_name FROM students WHERE active = 1 ORDER BY last_name, first_name"
  ).all() as Array<{ student_id: string; first_name: string; last_name: string }>;
  const sessionsByStudent = new Map(deriveBenchSessions().filter((session) => session.meetingDate === date).map((session) => [session.studentId, session]));
  const rows = students.map((student) => {
    const session = sessionsByStudent.get(student.student_id);
    return {
      studentId: student.student_id,
      firstName: student.first_name,
      lastName: student.last_name,
      status: session ? session.status === "open" ? "signed_in" : "signed_out" : "not_seen",
      checkInAt: session?.checkInAt,
      checkOutAt: session?.checkOutAt
    };
  });

  return {
    date,
    counts: {
      signedIn: rows.filter((row) => row.status === "signed_in").length,
      signedOut: rows.filter((row) => row.status === "signed_out").length,
      notSeen: rows.filter((row) => row.status === "not_seen").length
    },
    rows
  };
}

function buildMemberAttendanceReport(studentId: string) {
  const student = db.prepare("SELECT student_id, first_name, last_name FROM students WHERE student_id = ?").get(studentId) as { student_id: string; first_name: string; last_name: string } | undefined;
  if (!student) throw httpError(404, "Member not found");

  const sessions = deriveBenchSessions();
  const allDates = [...new Set(sessions.map((session) => session.meetingDate))].sort();
  const studentSessions = sessions.filter((session) => session.studentId === studentId);
  const presentDates = [...new Set(studentSessions.map((session) => session.meetingDate))];
  const presentDateSet = new Set(presentDates);
  const absentDates = allDates.filter((date) => !presentDateSet.has(date));

  return {
    studentId: student.student_id,
    firstName: student.first_name,
    lastName: student.last_name,
    totalMeetings: allDates.length,
    presentMeetings: presentDates.length,
    missedMeetings: absentDates.length,
    attendanceRate: allDates.length === 0 ? null : presentDates.length / allDates.length,
    presentDates,
    absentDates,
    openSessionDates: studentSessions.filter((session) => session.status === "open").map((session) => session.meetingDate)
  };
}

function deriveBenchSessions(): AttendanceSession[] {
  const rows = db.prepare("SELECT id, student_id, occurred_at, status FROM scan_events WHERE status = 'accepted' ORDER BY occurred_at ASC").all() as Array<{
    id: string;
    student_id: string;
    occurred_at: string;
    status: "accepted";
  }>;
  return deriveAttendanceSessions(rows.map((row) => ({ id: row.id, studentId: row.student_id, occurredAt: row.occurred_at, status: row.status })));
}

function setDisplayState(state: Omit<KioskDisplayState, "updatedAt">) {
  latestDisplayState = { ...state, updatedAt: new Date().toISOString() };
}

function currentDisplayState(): KioskDisplayState {
  if (latestDisplayState.status === "ready") return latestDisplayState;
  const ageMs = Date.now() - new Date(latestDisplayState.updatedAt).getTime();
  if (ageMs < 8_000) return latestDisplayState;
  latestDisplayState = {
    status: "ready",
    message: "Place finger on reader",
    detail: "Attendance kiosk ready",
    updatedAt: new Date().toISOString()
  };
  return latestDisplayState;
}

function insertScanEvent(
  kioskId: string,
  input: KioskSyncRequest["events"][number],
  syncedAt: string,
  status: "accepted" | "duplicate" | "rejected",
  rejectionReason?: string
): ScanEvent {
  const id = `${kioskId}:${input.localEventId}`;
  db.prepare(`
    INSERT INTO scan_events (id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status, rejection_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, kioskId, input.localEventId, input.studentId, input.occurredAt, syncedAt, input.source, status, rejectionReason ?? null);
  return { id, kioskId, localEventId: input.localEventId, studentId: input.studentId, occurredAt: input.occurredAt, syncedAt, source: input.source, status };
}

function rowToScanEvent(row: DbScanEvent): ScanEvent {
  return {
    id: row.id,
    kioskId: row.kiosk_id,
    localEventId: row.local_event_id,
    studentId: row.student_id,
    occurredAt: row.occurred_at,
    syncedAt: row.synced_at,
    source: "fingerprint",
    status: row.status
  };
}

function readBody<T>(request: typeof import("node:http").IncomingMessage.prototype): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(httpError(400, "Request body must be JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: typeof import("node:http").ServerResponse.prototype, status: number, data: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders()
  });
  response.end(JSON.stringify(data));
}

function sendNoContent(response: typeof import("node:http").ServerResponse.prototype) {
  response.writeHead(204, corsHeaders());
  response.end();
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-admin-email"
  };
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function requireNonEmptyString(value: string | undefined, name: string) {
  if (!value?.trim()) throw httpError(400, `${name} is required`);
  return value.trim();
}

interface DbScanEvent {
  id: string;
  kiosk_id: string;
  local_event_id: string;
  student_id: string;
  occurred_at: string;
  synced_at: string;
  source: "fingerprint";
  status: "accepted" | "duplicate" | "rejected";
  rejection_reason: string | null;
}

interface KioskDisplayState {
  status: "ready" | "welcome" | "goodbye" | "duplicate" | "rejected" | "unknown";
  message: string;
  detail: string;
  updatedAt: string;
}
