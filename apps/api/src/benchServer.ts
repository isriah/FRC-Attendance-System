import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DUPLICATE_WINDOW_MS, isDuplicateScan, type KioskSyncRequest, type ScanEvent } from "@frc-attendance/shared";
import { sha256Hex } from "./auth";

const port = Number(process.env.PORT ?? "8787");
const dbPath = process.env.BENCH_DB_PATH ?? "./bench-api.sqlite";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let enrollmentInProgress = false;
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

    if (request.method === "POST" && request.url === "/kiosk/sync") {
      const kioskId = await requireKiosk(request.headers.authorization);
      const body = await readBody<KioskSyncRequest>(request);
      if (body.kioskId !== kioskId) throw httpError(403, "Kiosk token does not match kioskId");
      sendJson(response, 200, syncKioskEvents(kioskId, body));
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

    return { memberId, slot, fingerLabel: fingerLabel || null, output: result.output.trim() };
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
  const now = new Date().toISOString();

  for (const input of body.events) {
    const existing = db.prepare("SELECT * FROM scan_events WHERE kiosk_id = ? AND local_event_id = ?").get(kioskId, input.localEventId) as DbScanEvent | undefined;
    if (existing) {
      const event = rowToScanEvent(existing);
      if (event.status === "accepted") accepted.push(event);
      else if (event.status === "duplicate") duplicates.push(event);
      else rejected.push({ ...input, reason: existing.rejection_reason ?? "previously rejected" });
      continue;
    }

    const student = db.prepare("SELECT active FROM students WHERE student_id = ?").get(input.studentId) as { active: number } | undefined;
    if (!student?.active) {
      rejected.push({ ...input, reason: "student is not active in roster" });
      insertScanEvent(kioskId, input, now, "rejected", "student is not active in roster");
      continue;
    }

    const previous = db.prepare("SELECT * FROM scan_events WHERE student_id = ? AND status = 'accepted' ORDER BY occurred_at DESC LIMIT 1").get(input.studentId) as DbScanEvent | undefined;
    if (isDuplicateScan(previous ? rowToScanEvent(previous) : undefined, input, DEFAULT_DUPLICATE_WINDOW_MS)) {
      duplicates.push(insertScanEvent(kioskId, input, now, "duplicate", "duplicate scan window"));
      continue;
    }

    accepted.push(insertScanEvent(kioskId, input, now, "accepted"));
  }

  return { accepted, duplicates, rejected };
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
