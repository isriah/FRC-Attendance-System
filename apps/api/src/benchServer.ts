import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DUPLICATE_WINDOW_MS, deriveAttendanceSessions, isDuplicateScan, meetingDateForTimestamp, requireIsoDate, requireIsoTimestamp, type AttendanceSession, type KioskCommand, type KioskCommandAction, type KioskCommandStatus, type KioskHealthReport, type KioskScanAcknowledgement, type KioskSyncRequest, type ScanEvent, type ScheduledMeeting } from "@frc-attendance/shared";
import { sha256Hex } from "./auth";
import { normalizeRosterMembers, type RosterMemberInput } from "./roster";

const port = Number(process.env.PORT ?? "8787");
const dbPath = process.env.BENCH_DB_PATH ?? "./bench-api.sqlite";
const remoteApiBaseUrl = process.env.REMOTE_API_BASE_URL?.replace(/\/$/, "");
const remoteKioskId = process.env.REMOTE_KIOSK_ID ?? process.env.KIOSK_ID;
const remoteKioskToken = process.env.REMOTE_KIOSK_TOKEN ?? process.env.KIOSK_TOKEN;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const localEnrollmentDbPath = process.env.KIOSK_DB_PATH ?? resolve(repoRoot, "apps/kiosk/kiosk-cache.sqlite");
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
    email TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS kiosks (
    kiosk_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Bench kiosk',
    location TEXT,
    token_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT,
    last_heartbeat_at TEXT,
    reader_online INTEGER,
    pending_scan_count INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    last_sync_error TEXT
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

  CREATE TABLE IF NOT EXISTS kiosk_commands (
    id TEXT PRIMARY KEY,
    kiosk_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT,
    requested_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT,
    message TEXT
  );

  CREATE INDEX IF NOT EXISTS kiosk_commands_kiosk_status_idx ON kiosk_commands(kiosk_id, status, requested_at);

  CREATE TABLE IF NOT EXISTS scheduled_meetings (
    id TEXT PRIMARY KEY,
    meeting_date TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    required INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS scheduled_meetings_required_date_idx ON scheduled_meetings(required, meeting_date);
`);
ensureColumn("kiosks", "name", "TEXT NOT NULL DEFAULT 'Bench kiosk'");
ensureColumn("kiosks", "location", "TEXT");
ensureColumn("kiosks", "last_heartbeat_at", "TEXT");
ensureColumn("kiosks", "reader_online", "INTEGER");
ensureColumn("kiosks", "pending_scan_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("kiosks", "last_sync_at", "TEXT");
ensureColumn("kiosks", "last_sync_error", "TEXT");
ensureColumn("students", "email", "TEXT");

async function seedBenchData() {
  db.prepare(`
    INSERT INTO students (student_id, first_name, last_name, active)
    VALUES ('100001', 'Bench', 'Member', 1)
    ON CONFLICT(student_id) DO UPDATE SET active = 1
  `).run();

  db.prepare(`
    INSERT INTO kiosks (kiosk_id, name, location, token_hash, active)
    VALUES ('bench-01', 'Bench kiosk', 'Pi bench', ?, 1)
    ON CONFLICT(kiosk_id) DO UPDATE SET token_hash = excluded.token_hash, active = 1
  `).run(await sha256Hex("dev-token"));

  seedSampleMeetings();
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

    if (request.method === "POST" && request.url === "/kiosk/health") {
      const kioskId = await requireKiosk(request.headers.authorization);
      const body = await readBody<KioskHealthReport>(request);
      if (body.kioskId !== kioskId) throw httpError(403, "Kiosk token does not match kioskId");
      updateKioskHealth(body);
      sendNoContent(response);
      return;
    }

    if (request.method === "POST" && request.url === "/kiosk/display/no-match") {
      await requireKiosk(request.headers.authorization);
      setDisplayState({
        status: "unknown",
        message: "Fingerprint not recognized",
        detail: "Try again with the same finger, or ask a mentor for help."
      });
      sendJson(response, 200, latestDisplayState);
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/kiosk/commands")) {
      const kioskId = await requireKiosk(request.headers.authorization);
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const requestedKioskId = url.searchParams.get("kioskId");
      if (requestedKioskId && requestedKioskId !== kioskId) throw httpError(403, "Kiosk token does not match kioskId");
      sendJson(response, 200, { commands: claimPendingKioskCommands(kioskId) });
      return;
    }

    const kioskCommandCompletion = request.url?.match(/^\/kiosk\/commands\/([^/]+)\/complete$/);
    if (request.method === "POST" && kioskCommandCompletion) {
      const kioskId = await requireKiosk(request.headers.authorization);
      const body = await readBody<{ status: KioskCommandStatus; message?: string }>(request);
      const commandId = kioskCommandCompletion[1];
      if (!commandId) throw httpError(400, "Kiosk command id is required");
      sendJson(response, 200, completeKioskCommand(kioskId, commandId, body));
      return;
    }

    if (request.method === "GET" && request.url === "/bench/events") {
      const events = db.prepare("SELECT * FROM scan_events ORDER BY occurred_at DESC LIMIT 50").all();
      sendJson(response, 200, { events });
      return;
    }

    if (request.method === "GET" && request.url === "/admin/meetings") {
      sendJson(response, 200, { meetings: listScheduledMeetings() });
      return;
    }

    if (request.method === "POST" && request.url === "/admin/meetings") {
      const body = await readBody<ScheduledMeetingInput>(request);
      sendJson(response, 201, createScheduledMeeting(body));
      return;
    }

    if (request.method === "POST" && request.url === "/admin/meetings/bulk-delete") {
      const body = await readBody<BulkScheduledMeetingDeleteInput>(request);
      sendJson(response, 200, bulkDeleteScheduledMeetings(body));
      return;
    }

    const adminMeeting = request.url?.match(/^\/admin\/meetings\/([^/]+)$/);
    if (adminMeeting && request.method === "PUT") {
      const body = await readBody<ScheduledMeetingInput>(request);
      const meetingId = adminMeeting[1];
      if (!meetingId) throw httpError(400, "Scheduled meeting id is required");
      sendJson(response, 200, updateScheduledMeeting(decodeURIComponent(meetingId), body));
      return;
    }

    if (adminMeeting && request.method === "DELETE") {
      const meetingId = adminMeeting[1];
      if (!meetingId) throw httpError(400, "Scheduled meeting id is required");
      deleteScheduledMeeting(decodeURIComponent(meetingId));
      sendNoContent(response);
      return;
    }

    if (request.method === "GET" && (request.url?.startsWith("/admin/members") || request.url?.startsWith("/admin/students"))) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const active = url.searchParams.get("active");
      const activeWhere = active === null ? "" : "WHERE active = ?";
      const statement = db.prepare(`SELECT student_id, first_name, last_name, email, active FROM students ${activeWhere} ORDER BY last_name, first_name`);
      const students = active === null ? statement.all() : statement.all(active === "true" || active === "1" ? 1 : 0);
      const members = students.map(rowToMember);
      sendJson(response, 200, url.pathname === "/admin/members" ? { members } : { students, members });
      return;
    }

    const adminStudentEmail = request.url?.match(/^\/admin\/(?:members|students)\/([^/]+)\/email$/);
    if (adminStudentEmail && request.method === "PUT") {
      const memberId = adminStudentEmail[1];
      if (!memberId) throw httpError(400, "Member id is required");
      const body = await readBody<{ email?: string | null }>(request);
      sendJson(response, 200, updateStudentEmail(decodeURIComponent(memberId), body.email ?? null));
      return;
    }

    const adminMemberDeactivate = request.url?.match(/^\/admin\/(?:members|students)\/([^/]+)\/deactivate$/);
    if (adminMemberDeactivate && request.method === "POST") {
      const memberId = adminMemberDeactivate[1];
      if (!memberId) throw httpError(400, "Member id is required");
      sendJson(response, 200, setMemberActive(decodeURIComponent(memberId), false));
      return;
    }

    const adminMemberReactivate = request.url?.match(/^\/admin\/(?:members|students)\/([^/]+)\/reactivate$/);
    if (adminMemberReactivate && request.method === "POST") {
      const memberId = adminMemberReactivate[1];
      if (!memberId) throw httpError(400, "Member id is required");
      sendJson(response, 200, setMemberActive(decodeURIComponent(memberId), true));
      return;
    }

    const adminMember = request.url?.match(/^\/admin\/(?:members|students)\/([^/]+)$/);
    if (adminMember && request.method === "DELETE") {
      const memberId = adminMember[1];
      if (!memberId) throw httpError(400, "Member id is required");
      sendJson(response, 200, hardDeleteMember(decodeURIComponent(memberId)));
      return;
    }

    if (request.method === "GET" && request.url === "/admin/kiosks") {
      const kiosks = db.prepare(`
        SELECT kiosk_id, name, location, active, last_seen_at, last_heartbeat_at, reader_online, pending_scan_count, last_sync_at, last_sync_error
        FROM kiosks
        ORDER BY name
      `).all();
      sendJson(response, 200, { kiosks });
      return;
    }

    if (request.method === "POST" && request.url === "/admin/kiosks") {
      const body = await readBody<{ kioskId: string; name: string; location?: string; token: string }>(request);
      const tokenHash = await sha256Hex(requireNonEmptyString(body.token, "token"));
      db.prepare(`
        INSERT INTO kiosks (kiosk_id, name, location, token_hash, active)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(kiosk_id) DO UPDATE SET
          name = excluded.name,
          location = excluded.location,
          token_hash = excluded.token_hash,
          active = 1
      `).run(requireNonEmptyString(body.kioskId, "kioskId"), requireNonEmptyString(body.name, "name"), body.location || null, tokenHash);
      sendNoContent(response);
      return;
    }

    if (request.method === "POST" && request.url === "/admin/roster/sync") {
      const body = await readBody<{ members: RosterMemberInput[] }>(request);
      const result = syncRoster(body.members);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/admin/roster/pull-production") {
      const roster = await fetchProductionRoster();
      const result = syncRoster(roster.members);
      sendJson(response, 200, {
        ...result,
        source: remoteApiBaseUrl,
        rosterSyncedAt: roster.rosterSyncedAt,
        pulledAt: new Date().toISOString()
      });
      return;
    }

    if (request.method === "POST" && request.url === "/admin/fingerprint/enroll") {
      const body = await readBody<{ memberId: string; slot: number; fingerLabel?: string; confirmOverwrite?: boolean }>(request);
      const result = await enrollFingerprint(body);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url === "/admin/fingerprint/enrollments") {
      sendJson(response, 200, { enrollments: listFingerprintEnrollments() });
      return;
    }

    if (request.method === "POST" && request.url === "/admin/fingerprint/map") {
      const body = await readBody<{ memberId: string; slot: number; fingerLabel?: string; confirmOverwrite?: boolean }>(request);
      sendJson(response, 200, mapFingerprintSlot(body));
      return;
    }

    if (request.method === "POST" && request.url === "/admin/fingerprint/enrollments/delete") {
      const body = await readBody<{ slot: number }>(request);
      sendJson(response, 200, deleteFingerprintEnrollment(body.slot));
      return;
    }

    if (request.method === "POST" && request.url === "/admin/kiosk-ui/restart") {
      await runCommand("systemctl", ["--user", "restart", "frc-kiosk-ui"]);
      sendJson(response, 200, { message: "Kiosk display service restarted. The kiosk screen should reconnect in a few seconds." });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/kiosk-commands")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, { commands: listRecentKioskCommands(Number(url.searchParams.get("limit") ?? 50)) });
      return;
    }

    const adminKioskCommand = request.url?.match(/^\/admin\/kiosks\/([^/]+)\/commands$/);
    if (request.method === "POST" && adminKioskCommand) {
      const body = await readBody<{ action: KioskCommandAction }>(request);
      const kioskIdParam = adminKioskCommand[1];
      if (!kioskIdParam) throw httpError(400, "Kiosk id is required");
      sendJson(response, 200, createKioskCommand(decodeURIComponent(kioskIdParam), body.action));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/presence")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, buildPresenceReport(url.searchParams.get("date") ?? undefined));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/sessions")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, { sessions: buildBenchAttendanceSessionReport(benchReportDateRangeFromUrl(url)) });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/meetings")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, { meetings: buildBenchMeetingSummaryReport(benchReportDateRangeFromUrl(url)) });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/meeting-absences")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, buildBenchMeetingAbsenceReport(requireNonEmptyString(url.searchParams.get("date") ?? undefined, "date")));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/roster-attendance")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, { members: buildBenchRosterAttendanceSummary(benchReportDateRangeFromUrl(url)) });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/reports/member")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const memberId = url.searchParams.get("memberId") ?? url.searchParams.get("studentId") ?? undefined;
      sendJson(response, 200, buildMemberAttendanceReport(
        requireNonEmptyString(memberId, "memberId"),
        benchReportDateRangeFromUrl(url)
      ));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/admin/export/legacy-sheets")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      sendJson(response, 200, buildBenchLegacySheetExport(benchReportDateRangeFromUrl(url)));
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
  console.log(`Seeded member 100001, kiosk bench-01, token dev-token`);
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

function updateKioskHealth(report: KioskHealthReport) {
  const pendingScanCount = Math.max(0, Math.floor(Number(report.pendingScanCount) || 0));
  db.prepare(`
    UPDATE kiosks
    SET
      last_heartbeat_at = ?,
      reader_online = ?,
      pending_scan_count = ?,
      last_sync_at = ?,
      last_sync_error = ?
    WHERE kiosk_id = ?
  `).run(
    new Date().toISOString(),
    report.readerOnline === null || report.readerOnline === undefined ? null : report.readerOnline ? 1 : 0,
    pendingScanCount,
    report.lastSyncAt ?? null,
    report.lastSyncError ?? null,
    report.kioskId
  );
}

function rowToMember(row: unknown) {
  const member = row as { student_id: string; first_name: string; last_name: string; email?: string | null; active: number };
  return {
    memberId: member.student_id,
    firstName: member.first_name,
    lastName: member.last_name,
    email: member.email ?? null,
    active: Boolean(member.active)
  };
}

function ensureColumn(table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function syncRoster(members: RosterMemberInput[]) {
  const normalizedMembers = normalizeRosterMembers(members);
  const seen = new Set<string>();
  const upsert = db.prepare(`
    INSERT INTO students (student_id, first_name, last_name, email, active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(student_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      email = COALESCE(excluded.email, students.email),
      active = 1
  `);

  const transaction = db.transaction(() => {
    for (const member of normalizedMembers) {
      seen.add(member.memberId);
      upsert.run(member.memberId, member.firstName, member.lastName, member.email ?? null);
    }
    if (normalizedMembers.length > 0) {
      const deactivateMissing = db.prepare(`UPDATE students SET active = 0 WHERE student_id NOT IN (${normalizedMembers.map(() => "?").join(",")})`);
      deactivateMissing.run(...normalizedMembers.map((member) => member.memberId));
    }
  });
  transaction();

  const deactivatedMissingMembers = normalizedMembers.length > 0;
  return { synced: seen.size, deactivatedMissingMembers, deactivatedMissingStudents: deactivatedMissingMembers };
}

function updateStudentEmail(memberId: string, email: string | null) {
  const normalizedMemberId = requireNonEmptyString(memberId, "memberId");
  const normalizedEmail = normalizeOptionalEmail(email ?? undefined);
  const result = db.prepare("UPDATE students SET email = ? WHERE student_id = ?").run(normalizedEmail ?? null, normalizedMemberId);
  if (result.changes === 0) throw httpError(404, "Member not found");
  return { memberId: normalizedMemberId, email: normalizedEmail ?? null };
}

function setMemberActive(memberId: string, active: boolean) {
  const normalizedMemberId = requireNonEmptyString(memberId, "memberId");
  requireExistingMember(normalizedMemberId);
  db.prepare("UPDATE students SET active = ? WHERE student_id = ?").run(active ? 1 : 0, normalizedMemberId);
  return rowToMember(requireExistingMember(normalizedMemberId));
}

function hardDeleteMember(memberId: string) {
  const normalizedMemberId = requireNonEmptyString(memberId, "memberId");
  const member = requireExistingMember(normalizedMemberId);
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM scan_events WHERE student_id = ?").run(normalizedMemberId);
    db.prepare("DELETE FROM students WHERE student_id = ?").run(normalizedMemberId);
  });
  transaction();
  const deletedMappings = deleteLocalEnrollmentMappingsForMember(normalizedMemberId);
  return {
    memberId: normalizedMemberId,
    firstName: member.first_name,
    lastName: member.last_name,
    hardDeleted: true,
    deletedFingerprintMappings: deletedMappings
  };
}

function requireExistingMember(memberId: string) {
  const member = db.prepare("SELECT student_id, first_name, last_name, email, active FROM students WHERE student_id = ?").get(memberId) as {
    student_id: string;
    first_name: string;
    last_name: string;
    email?: string | null;
    active: number;
  } | undefined;
  if (!member) throw httpError(404, "Member not found");
  return member;
}

function seedSampleMeetings() {
  const today = meetingDateForTimestamp(new Date().toISOString());
  const requiredId = `bench-required-${today}`;
  const optionalId = `bench-optional-${today}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO scheduled_meetings (id, meeting_date, title, required, notes, created_at, updated_at)
    VALUES (?, ?, 'Bench required meeting', 1, 'Seeded by the local bench API so zero-scan required meetings appear in reports.', ?, ?)
    ON CONFLICT(meeting_date) DO NOTHING
  `).run(requiredId, today, now, now);

  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const optionalDate = tomorrow.toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO scheduled_meetings (id, meeting_date, title, required, notes, created_at, updated_at)
    VALUES (?, ?, 'Bench optional meeting', 0, 'Seeded optional meeting; it is listed but excluded from attendance totals.', ?, ?)
    ON CONFLICT(meeting_date) DO NOTHING
  `).run(optionalId, optionalDate, now, now);
}

function listScheduledMeetings(): ScheduledMeeting[] {
  const rows = db.prepare(`
    SELECT id, meeting_date, title, required, starts_at, ends_at, notes, created_at, updated_at
    FROM scheduled_meetings
    ORDER BY meeting_date, starts_at
  `).all() as ScheduledMeetingRow[];
  return rows.map(rowToScheduledMeeting);
}

function createScheduledMeeting(input: ScheduledMeetingInput): ScheduledMeeting {
  const normalized = normalizeMeetingInput(input);
  const now = new Date().toISOString();
  const meeting: ScheduledMeeting = {
    id: crypto.randomUUID(),
    meetingDate: normalized.meetingDate,
    title: normalized.title,
    required: normalized.required,
    startsAt: normalized.startsAt,
    endsAt: normalized.endsAt,
    notes: normalized.notes,
    createdAt: now,
    updatedAt: now
  };

  try {
    db.prepare(`
      INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      meeting.id,
      meeting.meetingDate,
      meeting.title,
      meeting.required ? 1 : 0,
      meeting.startsAt ?? null,
      meeting.endsAt ?? null,
      meeting.notes ?? null,
      meeting.createdAt,
      meeting.updatedAt
    );
  } catch (error) {
    throwUniqueMeetingDateError(error, meeting.meetingDate);
  }

  return meeting;
}

function updateScheduledMeeting(meetingId: string, input: ScheduledMeetingInput): ScheduledMeeting {
  const existing = getScheduledMeetingRow(meetingId);
  if (!existing) throw httpError(404, "Scheduled meeting not found");

  const normalized = normalizeMeetingInput(input);
  const updatedAt = new Date().toISOString();
  try {
    db.prepare(`
      UPDATE scheduled_meetings
      SET meeting_date = ?, title = ?, required = ?, starts_at = ?, ends_at = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      normalized.meetingDate,
      normalized.title,
      normalized.required ? 1 : 0,
      normalized.startsAt ?? null,
      normalized.endsAt ?? null,
      normalized.notes ?? null,
      updatedAt,
      meetingId
    );
  } catch (error) {
    throwUniqueMeetingDateError(error, normalized.meetingDate);
  }

  const updated = getScheduledMeetingRow(meetingId);
  if (!updated) throw httpError(404, "Scheduled meeting not found");
  return rowToScheduledMeeting(updated);
}

function deleteScheduledMeeting(meetingId: string) {
  const existing = getScheduledMeetingRow(meetingId);
  if (!existing) throw httpError(404, "Scheduled meeting not found");
  db.prepare("DELETE FROM scheduled_meetings WHERE id = ?").run(meetingId);
}

function bulkDeleteScheduledMeetings(input: BulkScheduledMeetingDeleteInput) {
  const meetingIds = requireMeetingIds(input.meetingIds);
  const deleteMeeting = db.prepare("DELETE FROM scheduled_meetings WHERE id = ?");
  const deleteMany = db.transaction((ids: string[]) => {
    let deleted = 0;
    for (const meetingId of ids) {
      deleted += deleteMeeting.run(meetingId).changes;
    }
    return deleted;
  });
  return { deleted: deleteMany(meetingIds) };
}

function normalizeMeetingInput(input: ScheduledMeetingInput): Omit<ScheduledMeeting, "id" | "createdAt" | "updatedAt"> {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const title = requireNonEmptyString(input.title, "title");
  const required = input.required === undefined ? true : requireBoolean(input.required, "required");
  const startsAt = optionalIsoTimestamp(input.startsAt, "startsAt");
  const endsAt = optionalIsoTimestamp(input.endsAt, "endsAt");
  if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    throw httpError(400, "endsAt must be after startsAt");
  }

  return {
    meetingDate,
    title,
    required,
    startsAt,
    endsAt,
    notes: optionalTrimmedString(input.notes)
  };
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") throw httpError(400, `${fieldName} must be a boolean`);
  return value;
}

function optionalIsoTimestamp(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireIsoTimestamp(value, fieldName);
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw httpError(400, "notes must be a string");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireMeetingIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw httpError(400, "meetingIds must be an array");
  const meetingIds = value.map((meetingId) => requireNonEmptyString(meetingId, "meetingId"));
  if (meetingIds.length === 0) throw httpError(400, "Select at least one scheduled meeting");
  return [...new Set(meetingIds)];
}

function getScheduledMeetingRow(meetingId: string): ScheduledMeetingRow | undefined {
  return db.prepare(`
    SELECT id, meeting_date, title, required, starts_at, ends_at, notes, created_at, updated_at
    FROM scheduled_meetings
    WHERE id = ?
  `).get(requireNonEmptyString(meetingId, "meetingId")) as ScheduledMeetingRow | undefined;
}

function throwUniqueMeetingDateError(error: unknown, meetingDate: string): never {
  if (error instanceof Error && /unique|constraint/i.test(error.message)) {
    throw httpError(409, `Scheduled meeting already exists for ${meetingDate}`);
  }
  throw error;
}

async function fetchProductionRoster(): Promise<{ members: RosterMemberInput[]; rosterSyncedAt: string | null }> {
  if (!remoteApiBaseUrl) throw httpError(400, "REMOTE_API_BASE_URL is not configured for this bench API");
  if (!remoteKioskId) throw httpError(400, "REMOTE_KIOSK_ID or KIOSK_ID is required to pull the production roster");
  if (!remoteKioskToken) throw httpError(400, "REMOTE_KIOSK_TOKEN or KIOSK_TOKEN is required to pull the production roster");

  const response = await fetch(`${remoteApiBaseUrl}/kiosk/roster?kioskId=${encodeURIComponent(remoteKioskId)}`, {
    headers: { authorization: `Bearer ${remoteKioskToken}` }
  });
  if (!response.ok) {
    const text = await response.text();
    throw httpError(response.status, `Production roster pull failed: ${text}`);
  }

  const body = await response.json() as { members?: RosterMemberInput[]; rosterSyncedAt?: string | null };
  return {
    members: normalizeRosterMembers(body.members),
    rosterSyncedAt: body.rosterSyncedAt ?? null
  };
}

function createKioskCommand(kioskId: string, action: KioskCommandAction): KioskCommand {
  if (!["restart_display", "restart_services", "reboot_system"].includes(action)) throw httpError(400, "Unsupported kiosk command action");
  const kiosk = db.prepare("SELECT kiosk_id FROM kiosks WHERE kiosk_id = ? AND active = 1").get(kioskId) as { kiosk_id: string } | undefined;
  if (!kiosk) throw httpError(404, "Kiosk not found or inactive");

  const command: KioskCommand = {
    id: crypto.randomUUID(),
    kioskId,
    action,
    status: "pending",
    requestedAt: new Date().toISOString()
  };
  db.prepare(
    "INSERT INTO kiosk_commands (id, kiosk_id, action, status, requested_at) VALUES (?, ?, ?, 'pending', ?)"
  ).run(command.id, kioskId, action, command.requestedAt);
  return command;
}

function listRecentKioskCommands(limit = 50): KioskCommand[] {
  const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 200));
  const rows = db.prepare("SELECT * FROM kiosk_commands ORDER BY requested_at DESC LIMIT ?").all(cappedLimit) as KioskCommandRow[];
  return rows.map(rowToCommand);
}

function claimPendingKioskCommands(kioskId: string): KioskCommand[] {
  const now = new Date().toISOString();
  const rows = db.prepare("SELECT * FROM kiosk_commands WHERE kiosk_id = ? AND status = 'pending' ORDER BY requested_at ASC LIMIT 5").all(kioskId) as KioskCommandRow[];
  for (const row of rows) {
    db.prepare("UPDATE kiosk_commands SET status = 'running', claimed_at = ? WHERE id = ? AND status = 'pending'").run(now, row.id);
  }
  return rows.map((row) => rowToCommand({ ...row, status: "running", claimed_at: now }));
}

function completeKioskCommand(kioskId: string, commandId: string, input: { status: KioskCommandStatus; message?: string }): KioskCommand {
  if (!["completed", "failed"].includes(input.status)) throw httpError(400, "Command completion status must be completed or failed");
  const now = new Date().toISOString();
  db.prepare("UPDATE kiosk_commands SET status = ?, completed_at = ?, message = ? WHERE id = ? AND kiosk_id = ?")
    .run(input.status, now, input.message ?? null, commandId, kioskId);
  const row = db.prepare("SELECT * FROM kiosk_commands WHERE id = ? AND kiosk_id = ?").get(commandId, kioskId) as KioskCommandRow | undefined;
  if (!row) throw httpError(404, "Kiosk command not found");
  return rowToCommand(row);
}

async function enrollFingerprint(input: { memberId: string; slot: number; fingerLabel?: string; confirmOverwrite?: boolean }) {
  if (enrollmentInProgress) throw httpError(409, "Fingerprint enrollment is already in progress");

  const { memberId, slot, fingerLabel } = validateFingerprintMappingInput(input);
  requireOverwriteConfirmation(slot, input.confirmOverwrite);

  enrollmentInProgress = true;
  try {
    await runCommand("systemctl", ["--user", "stop", "frc-kiosk-service"]);
    const result = await runCommand("python3", [
      resolve(repoRoot, "apps/kiosk/enroll_fingerprint.py"),
      "--member-id",
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

function mapFingerprintSlot(input: { memberId: string; slot: number; fingerLabel?: string; confirmOverwrite?: boolean }) {
  const { memberId, slot, fingerLabel } = validateFingerprintMappingInput(input);
  requireOverwriteConfirmation(slot, input.confirmOverwrite);
  saveLocalEnrollmentMapping(memberId, slot, fingerLabel);
  return {
    memberId,
    slot,
    fingerLabel: fingerLabel || null,
    message: `Fingerprint slot ${slot} now maps to member ${memberId}.`
  };
}

function validateFingerprintMappingInput(input: { memberId: string; slot: number; fingerLabel?: string }) {
  const memberId = input.memberId?.trim();
  const slot = Number(input.slot);
  const fingerLabel = input.fingerLabel?.trim();
  if (!memberId) throw httpError(400, "memberId is required");
  if (!Number.isInteger(slot) || slot < 1 || slot > 200) throw httpError(400, "slot must be an integer from 1 to 200");

  const student = db.prepare("SELECT active FROM students WHERE student_id = ?").get(memberId) as { active: number } | undefined;
  if (!student?.active) throw httpError(400, "member is not active in roster");
  return { memberId, slot, fingerLabel };
}

function listFingerprintEnrollments(): FingerprintEnrollmentRow[] {
  const localDb = openLocalEnrollmentDb();
  try {
    const rows = localDb.prepare(`
      SELECT student_id, template_slot, finger_label, enrolled_at
      FROM local_enrollments
      WHERE deleted_at IS NULL
      ORDER BY template_slot ASC
    `).all() as Array<{ student_id: string; template_slot: number; finger_label: string | null; enrolled_at: string }>;

    return rows.map((row) => {
      const student = db.prepare("SELECT first_name, last_name, active FROM students WHERE student_id = ?").get(row.student_id) as { first_name: string; last_name: string; active: number } | undefined;
      return {
        memberId: row.student_id,
        firstName: student?.first_name,
        lastName: student?.last_name,
        active: student?.active ?? 0,
        slot: row.template_slot,
        fingerLabel: row.finger_label ?? undefined,
        enrolledAt: row.enrolled_at
      };
    });
  } finally {
    localDb.close();
  }
}

function deleteFingerprintEnrollment(slotInput: number) {
  const slot = Number(slotInput);
  if (!Number.isInteger(slot) || slot < 1 || slot > 200) throw httpError(400, "slot must be an integer from 1 to 200");
  const localDb = openLocalEnrollmentDb();
  try {
    const deletedAt = new Date().toISOString();
    const result = localDb.prepare("UPDATE local_enrollments SET deleted_at = ? WHERE template_slot = ? AND deleted_at IS NULL").run(deletedAt, slot);
    if (result.changes === 0) throw httpError(404, "Fingerprint enrollment not found");
    return { slot, deletedAt, message: `Fingerprint slot ${slot} mapping removed. The sensor template was not deleted.` };
  } finally {
    localDb.close();
  }
}

function deleteLocalEnrollmentMappingsForMember(memberId: string) {
  const localDb = openLocalEnrollmentDb();
  try {
    const deletedAt = new Date().toISOString();
    const result = localDb.prepare("UPDATE local_enrollments SET deleted_at = ? WHERE student_id = ? AND deleted_at IS NULL").run(deletedAt, memberId);
    return result.changes;
  } finally {
    localDb.close();
  }
}

function requireOverwriteConfirmation(slot: number, confirmed = false) {
  const localDb = openLocalEnrollmentDb();
  try {
    const existing = localDb.prepare(`
      SELECT student_id, template_slot, finger_label
      FROM local_enrollments
      WHERE template_slot = ? AND deleted_at IS NULL
    `).get(slot) as { student_id: string; template_slot: number; finger_label: string | null } | undefined;
    if (existing && !confirmed) {
      throw httpError(409, `slot ${slot} is already mapped to member ${existing.student_id}; confirm overwrite to replace it`);
    }
  } finally {
    localDb.close();
  }
}

function saveLocalEnrollmentMapping(memberId: string, slot: number, fingerLabel?: string) {
  const localDb = openLocalEnrollmentDb();
  try {
    const enrolledAt = new Date().toISOString();
    const transaction = localDb.transaction(() => {
      localDb.prepare("UPDATE local_enrollments SET deleted_at = ? WHERE template_slot = ? AND deleted_at IS NULL").run(enrolledAt, slot);
      localDb.prepare(`
        INSERT INTO local_enrollments (student_id, template_slot, finger_label, enrolled_at, deleted_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(student_id, template_slot) DO UPDATE SET
          finger_label = excluded.finger_label,
          enrolled_at = excluded.enrolled_at,
          deleted_at = NULL
      `).run(memberId, slot, fingerLabel || null, enrolledAt);
    });
    transaction();
  } finally {
    localDb.close();
  }
}

function openLocalEnrollmentDb() {
  const localDb = new Database(localEnrollmentDbPath);
  localDb.pragma("journal_mode = WAL");
  localDb.exec(`
    CREATE TABLE IF NOT EXISTS local_enrollments (
      student_id TEXT NOT NULL,
      template_slot INTEGER NOT NULL,
      finger_label TEXT,
      enrolled_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (student_id, template_slot)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS local_enrollments_active_slot_idx
    ON local_enrollments(template_slot)
    WHERE deleted_at IS NULL;
  `);
  return localDb;
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

  for (const rawInput of body.events) {
    const input = normalizeKioskSyncEvent(rawInput);
    const existing = db.prepare("SELECT * FROM scan_events WHERE kiosk_id = ? AND local_event_id = ?").get(kioskId, input.localEventId) as DbScanEvent | undefined;
    if (existing) {
      const event = rowToScanEvent(existing);
      if (event.status === "accepted") accepted.push(event);
      else if (event.status === "duplicate") duplicates.push(event);
      else rejected.push({ ...input, reason: existing.rejection_reason ?? "previously rejected" });
      acknowledgements.push(buildAcknowledgement(input, event.status, existing.rejection_reason ?? undefined));
      continue;
    }

    const student = db.prepare("SELECT active FROM students WHERE student_id = ?").get(input.memberId) as { active: number } | undefined;
    if (!student?.active) {
      rejected.push({ ...input, reason: "member is not active in roster" });
      insertScanEvent(kioskId, input, now, "rejected", "member is not active in roster");
      acknowledgements.push(buildAcknowledgement(input, "rejected", "member is not active in roster"));
      continue;
    }

    const previous = db.prepare("SELECT * FROM scan_events WHERE student_id = ? AND status = 'accepted' ORDER BY occurred_at DESC LIMIT 1").get(input.memberId) as DbScanEvent | undefined;
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

function normalizeKioskSyncEvent(input: KioskSyncRequest["events"][number]): NormalizedKioskSyncEventInput {
  const memberId = input.memberId ?? input.studentId;
  if (!memberId?.trim()) throw httpError(400, "memberId is required");
  return {
    localEventId: input.localEventId,
    memberId: memberId.trim(),
    occurredAt: input.occurredAt,
    source: input.source
  };
}

type NormalizedKioskSyncEventInput = KioskSyncRequest["events"][number] & { memberId: string };

function buildAcknowledgement(
  input: NormalizedKioskSyncEventInput,
  status: "accepted" | "duplicate" | "rejected",
  reason?: string
): KioskScanAcknowledgement {
  const student = db.prepare("SELECT first_name, last_name FROM students WHERE student_id = ?").get(input.memberId) as { first_name: string; last_name: string } | undefined;
  const displayName = student ? `${student.first_name} ${student.last_name}` : undefined;
  const attendance = student ? buildBenchAttendanceSummary(input.memberId) : { rate: null };
  const showAttendanceSummary = kioskShowsAttendanceSummary();
  const memberLabel = displayName ?? memberIdLabel(input.memberId);
  const scannedAt = formatKioskTime(input.occurredAt);

  if (status === "duplicate") {
    return {
      localEventId: input.localEventId,
      memberId: input.memberId,
      status,
      displayName,
      attendanceRate: attendance.rate,
      attendanceSummary: attendance.summary,
      kioskMessage: "Already recorded",
      kioskDetail: `${memberLabel}, your attendance was already recorded. Please wait a moment before scanning again.`,
      message: displayName ? `${displayName} was already recorded.` : "Scan was already recorded."
    };
  }

  if (status === "rejected") {
    const rosterMessage = reason === "member is not active in roster" || reason === "student is not active in roster"
      ? "this Member ID is not active. Ask a mentor for help."
      : "This scan could not be accepted. Ask a mentor for help.";
    return {
      localEventId: input.localEventId,
      memberId: input.memberId,
      status,
      displayName,
      attendanceRate: attendance.rate,
      attendanceSummary: attendance.summary,
      kioskMessage: "Roster issue",
      kioskDetail: `${memberLabel}, ${rosterMessage}`,
      message: rosterMessage
    };
  }

  const action = nextAcceptedScanAction(input.memberId, input.occurredAt);
  const actionLabel = action === "check_out" ? "Checked out" : "Checked in";
  const greeting = action === "check_out" ? "Goodbye" : "Welcome";
  const attendanceDetail = showAttendanceSummary ? attendance.summary : undefined;
  return {
    localEventId: input.localEventId,
    memberId: input.memberId,
    status,
    displayName,
    action,
    attendanceRate: attendance.rate,
    attendanceSummary: attendance.summary,
    kioskMessage: `${greeting}, ${displayName ?? memberIdLabel(input.memberId)}`,
    kioskDetail: [`${actionLabel} at ${scannedAt}.`, attendanceDetail].filter(Boolean).join(" "),
    message: action === "check_in" ? `Welcome, ${displayName ?? memberIdLabel(input.memberId)}` : `Goodbye, ${displayName ?? memberIdLabel(input.memberId)}`
  };
}

function nextAcceptedScanAction(memberId: string, occurredAt: string): "check_in" | "check_out" {
  const meetingDate = meetingDateForTimestamp(occurredAt);
  const count = db.prepare("SELECT COUNT(*) AS count FROM scan_events WHERE student_id = ? AND status = 'accepted' AND date(occurred_at) = ?").get(memberId, meetingDate) as { count: number };
  return count.count % 2 === 1 ? "check_in" : "check_out";
}

function displayStateForAcknowledgement(acknowledgement: KioskScanAcknowledgement): Omit<KioskDisplayState, "updatedAt"> {
  if (acknowledgement.status === "duplicate") {
    return {
      status: "duplicate",
      message: acknowledgement.kioskMessage ?? "Already recorded",
      detail: acknowledgement.kioskDetail ?? acknowledgement.displayName ?? `Member ${acknowledgement.memberId}`
    };
  }

  if (acknowledgement.status === "rejected") {
    return {
      status: "rejected",
      message: acknowledgement.kioskMessage ?? "Scan needs help",
      detail: acknowledgement.kioskDetail ?? acknowledgement.message
    };
  }

  return {
    status: acknowledgement.action === "check_out" ? "goodbye" : "welcome",
    message: acknowledgement.kioskMessage ?? (acknowledgement.action === "check_out" ? "Goodbye" : "Welcome"),
    detail: acknowledgement.kioskDetail ?? [acknowledgement.displayName ?? memberIdLabel(acknowledgement.memberId), acknowledgement.attendanceSummary].filter(Boolean).join(" - ")
  };
}

function memberIdLabel(memberId: string): string {
  return `Member ID ${memberId}`;
}

function kioskShowsAttendanceSummary(): boolean {
  const value = process.env.KIOSK_SHOW_ATTENDANCE_SUMMARY;
  if (value === undefined || value === "") return true;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function buildBenchAttendanceSummary(memberId: string): { rate: number | null; summary?: string } {
  const report = buildMemberAttendanceReport(memberId);
  if (report.attendanceRate === null) return { rate: null };
  return {
    rate: report.attendanceRate,
    summary: `Attendance ${Math.round(report.attendanceRate * 100)}% (${report.presentMeetings}/${report.totalMeetings})`
  };
}

function formatKioskTime(occurredAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York"
  }).format(new Date(occurredAt));
}

function formatLegacyDate(meetingDate: string): string {
  const [year, month, day] = meetingDate.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

function formatLegacyTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York"
  }).format(new Date(iso));
}

function buildPresenceReport(date = meetingDateForTimestamp(new Date().toISOString())) {
  const students = db.prepare(
    "SELECT student_id, first_name, last_name FROM students WHERE active = 1 ORDER BY last_name, first_name"
  ).all() as Array<{ student_id: string; first_name: string; last_name: string }>;
  const sessionsByStudent = new Map(deriveBenchSessions().filter((session) => session.meetingDate === date).map((session) => [session.memberId, session]));
  const rows = students.map((student) => {
    const session = sessionsByStudent.get(student.student_id);
    return {
      memberId: student.student_id,
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

interface BenchReportDateRange {
  startDate?: string;
  endDate?: string;
}

function buildMemberAttendanceReport(memberId: string, range: BenchReportDateRange = {}) {
  const student = db.prepare("SELECT student_id, first_name, last_name FROM students WHERE student_id = ?").get(memberId) as { student_id: string; first_name: string; last_name: string } | undefined;
  if (!student) throw httpError(404, "Member not found");

  const sessions = deriveBenchSessions().filter((session) => isDateInRange(session.meetingDate, range));
  const allDates = benchReportMeetingDates(range);
  const allDateSet = new Set(allDates);
  const studentSessions = sessions.filter((session) => session.memberId === memberId);
  const presentDates = [...new Set(studentSessions.map((session) => session.meetingDate))].filter((date) => allDateSet.has(date));
  const presentDateSet = new Set(presentDates);
  const absentDates = allDates.filter((date) => !presentDateSet.has(date));
  const lastSeenAt = studentSessions.reduce<string | undefined>((latest, session) => {
    if (!latest || session.checkInAt > latest) return session.checkInAt;
    return latest;
  }, undefined);

  return {
    memberId: student.student_id,
    firstName: student.first_name,
    lastName: student.last_name,
    startDate: range.startDate,
    endDate: range.endDate,
    totalMeetings: allDates.length,
    presentMeetings: presentDates.length,
    missedMeetings: absentDates.length,
    attendanceRate: allDates.length === 0 ? null : presentDates.length / allDates.length,
    lastSeenAt,
    presentDates,
    absentDates,
    openSessionDates: studentSessions.filter((session) => session.status === "open" && allDateSet.has(session.meetingDate)).map((session) => session.meetingDate)
  };
}

function buildBenchAttendanceSessionReport(range: BenchReportDateRange = {}, limit = 500) {
  const meetings = (db.prepare("SELECT meeting_date, title, required FROM scheduled_meetings ORDER BY meeting_date DESC").all() as Array<{
    meeting_date: string;
    title: string;
    required: number;
  }>).filter((meeting) => isDateInRange(meeting.meeting_date, range));
  const meetingsByDate = new Map(meetings.map((meeting) => [meeting.meeting_date, meeting]));
  const sessions = deriveBenchSessions().filter((session) => isDateInRange(session.meetingDate, range));
  const sessionDates = new Set(sessions.map((session) => session.meetingDate));
  const sessionRows = sessions.map((session) => {
    const meeting = meetingsByDate.get(session.meetingDate);
    return {
      member_id: session.memberId,
      meeting_date: session.meetingDate,
      meeting_title: meeting?.title ?? null,
      required: meeting?.required ?? 1,
      has_attendance: 1,
      check_in_at: session.checkInAt,
      check_out_at: session.checkOutAt,
      status: session.status
    };
  });
  const zeroScanRows = meetings
    .filter((meeting) => !sessionDates.has(meeting.meeting_date))
    .map((meeting) => ({
      member_id: null,
      meeting_date: meeting.meeting_date,
      meeting_title: meeting.title,
      required: meeting.required,
      has_attendance: 0,
      check_in_at: null,
      check_out_at: null,
      status: "scheduled"
    }));

  return [...sessionRows, ...zeroScanRows]
    .sort((left, right) => right.meeting_date.localeCompare(left.meeting_date) || String(left.member_id ?? "").localeCompare(String(right.member_id ?? "")))
    .slice(0, limit);
}

function buildBenchMeetingSummaryReport(range: BenchReportDateRange = {}, limit = 500) {
  const meetings = (db.prepare("SELECT meeting_date, title, required, starts_at, ends_at FROM scheduled_meetings ORDER BY meeting_date DESC").all() as Array<{
    meeting_date: string;
    title: string;
    required: number;
    starts_at: string | null;
    ends_at: string | null;
  }>).filter((meeting) => isDateInRange(meeting.meeting_date, range));
  const sessions = deriveBenchSessions().filter((session) => isDateInRange(session.meetingDate, range));
  const activeStudentRows = db.prepare("SELECT student_id FROM students WHERE active = 1").all() as Array<{ student_id: string }>;
  const activememberIds = new Set(activeStudentRows.map((student) => student.student_id));
  const meetingsByDate = new Map(meetings.map((meeting) => [meeting.meeting_date, meeting]));
  const sessionsByDate = sessions.reduce<Map<string, { presentCount: number; activePresentCount: number; openCheckIns: number; presentStudents: Set<string>; activePresentStudents: Set<string> }>>((groups, session) => {
    const group = groups.get(session.meetingDate) ?? {
      presentCount: 0,
      activePresentCount: 0,
      openCheckIns: 0,
      presentStudents: new Set<string>(),
      activePresentStudents: new Set<string>()
    };
    if (!group.presentStudents.has(session.memberId)) {
      group.presentStudents.add(session.memberId);
      group.presentCount += 1;
    }
    if (activememberIds.has(session.memberId) && !group.activePresentStudents.has(session.memberId)) {
      group.activePresentStudents.add(session.memberId);
      group.activePresentCount += 1;
    }
    if (session.status === "open") group.openCheckIns += 1;
    groups.set(session.meetingDate, group);
    return groups;
  }, new Map());
  const activeCount = activeStudentRows.length;
  const hasScheduledMeetings = benchHasScheduledMeetings();
  const dates = [...new Set([...meetingsByDate.keys(), ...sessionsByDate.keys()])].sort((left, right) => right.localeCompare(left));

  return dates.map((meetingDate) => {
    const meeting = meetingsByDate.get(meetingDate);
    const session = sessionsByDate.get(meetingDate);
    const scheduled = Boolean(meeting);
    const required = meeting ? Boolean(meeting.required) : !hasScheduledMeetings;
    const presentCount = session?.presentCount ?? 0;
    return {
      meetingDate,
      title: meeting?.title ?? null,
      required,
      startsAt: meeting?.starts_at ?? undefined,
      endsAt: meeting?.ends_at ?? undefined,
      scheduled,
      hasAttendance: Boolean(session),
      zeroScan: scheduled && !session,
      presentCount,
      activePresentCount: session?.activePresentCount ?? 0,
      absentCount: required ? Math.max(activeCount - (session?.activePresentCount ?? 0), 0) : 0,
      openCheckIns: session?.openCheckIns ?? 0
    };
  }).slice(0, limit);
}

function buildBenchMeetingAbsenceReport(meetingDate: string) {
  const date = requireIsoDate(meetingDate, "date");
  const meeting = db.prepare("SELECT meeting_date, title, required, starts_at, ends_at FROM scheduled_meetings WHERE meeting_date = ?").get(date) as {
    meeting_date: string;
    title: string;
    required: number;
    starts_at: string | null;
    ends_at: string | null;
  } | undefined;
  const presentIds = new Set(deriveBenchSessions().filter((session) => session.meetingDate === date).map((session) => session.memberId));
  const required = meeting ? Boolean(meeting.required) : !benchHasScheduledMeetings() && presentIds.size > 0;
  const students = db.prepare("SELECT student_id, first_name, last_name FROM students WHERE active = 1 ORDER BY last_name, first_name").all() as Array<{
    student_id: string;
    first_name: string;
    last_name: string;
  }>;
  const rows = required
    ? students
      .filter((student) => !presentIds.has(student.student_id))
      .map((student) => ({ memberId: student.student_id, firstName: student.first_name, lastName: student.last_name }))
    : [];

  return {
    meetingDate: date,
    title: meeting?.title ?? null,
    required,
    startsAt: meeting?.starts_at ?? undefined,
    endsAt: meeting?.ends_at ?? undefined,
    absentCount: rows.length,
    rows
  };
}

function buildBenchRosterAttendanceSummary(range: BenchReportDateRange = {}) {
  const activeStudents = db.prepare("SELECT student_id FROM students WHERE active = 1 ORDER BY last_name, first_name").all() as Array<{ student_id: string }>;
  return activeStudents.map((student) => {
    const report = buildMemberAttendanceReport(student.student_id, range);
    return {
      memberId: report.memberId,
      firstName: report.firstName,
      lastName: report.lastName,
      requiredMeetings: report.totalMeetings,
      presentMeetings: report.presentMeetings,
      missedMeetings: report.missedMeetings,
      attendanceRate: report.attendanceRate,
      lastSeenAt: report.lastSeenAt,
      openSessionDates: report.openSessionDates,
      openSessionWarning: report.openSessionDates.length > 0
    };
  });
}

function buildBenchLegacySheetExport(range: BenchReportDateRange = {}) {
  const sessions = deriveBenchSessions().filter((session) => isDateInRange(session.meetingDate, range));
  const meetings = (db.prepare("SELECT meeting_date, title, required, starts_at, ends_at FROM scheduled_meetings ORDER BY meeting_date").all() as Array<{
    meeting_date: string;
    title: string;
    required: number;
    starts_at: string | null;
    ends_at: string | null;
  }>).filter((meeting) => isDateInRange(meeting.meeting_date, range));
  const meetingSummary = buildBenchMeetingSummaryReport(range);
  const rosterAttendance = buildBenchRosterAttendanceSummary(range);
  const requiredMeetingAbsences = meetingSummary.filter((meeting) => meeting.required).map((meeting) => buildBenchMeetingAbsenceReport(meeting.meetingDate));
  const sessionCountsByDate = sessions.reduce<Map<string, number>>((counts, session) => {
    counts.set(session.meetingDate, (counts.get(session.meetingDate) ?? 0) + 1);
    return counts;
  }, new Map());

  return {
    generatedAt: new Date().toISOString(),
    ranges: {
      MeetingSummary: meetingSummary.map((meeting) => [
        formatLegacyDate(meeting.meetingDate),
        meeting.title ?? "Unscheduled attendance",
        meeting.required ? "required" : "optional",
        meeting.startsAt ? formatLegacyTime(meeting.startsAt) : "",
        meeting.endsAt ? formatLegacyTime(meeting.endsAt) : "",
        meeting.scheduled ? "scheduled" : "attendance-only",
        meeting.presentCount,
        meeting.required ? meeting.absentCount : "",
        meeting.openCheckIns,
        meeting.zeroScan ? "zero scans" : ""
      ]),
      MeetingAbsences: requiredMeetingAbsences.flatMap((meeting) => meeting.rows.map((student) => [
        formatLegacyDate(meeting.meetingDate),
        meeting.title ?? "Required attendance",
        student.memberId,
        student.firstName,
        student.lastName
      ])),
      RosterAttendance: rosterAttendance.map((report) => [
        report.memberId,
        report.firstName,
        report.lastName,
        report.requiredMeetings,
        report.presentMeetings,
        report.missedMeetings,
        report.attendanceRate === null ? "" : Math.round(report.attendanceRate * 1000) / 1000,
        report.lastSeenAt ? formatLegacyDate(report.lastSeenAt.slice(0, 10)) : "",
        report.openSessionWarning ? "open check-in" : ""
      ]),
      AttendanceLogIn: sessions.map((session) => [
        session.memberId,
        formatLegacyDate(session.meetingDate),
        formatLegacyTime(session.checkInAt)
      ]),
      AttendanceLogOut: sessions
        .filter((session) => Boolean(session.checkOutAt))
        .map((session) => [
          session.memberId,
          formatLegacyDate(session.meetingDate),
          formatLegacyTime(session.checkOutAt as string)
        ]),
      ScheduledMeetings: meetings.map((meeting) => [
        formatLegacyDate(meeting.meeting_date),
        meeting.title,
        meeting.required ? "required" : "optional",
        meeting.starts_at ? formatLegacyTime(meeting.starts_at) : "",
        meeting.ends_at ? formatLegacyTime(meeting.ends_at) : "",
        sessionCountsByDate.get(meeting.meeting_date) ?? 0
      ]),
      MemberAttendanceSummary: rosterAttendance.map((report) => [
        report.memberId,
        report.firstName,
        report.lastName,
        report.requiredMeetings,
        report.presentMeetings,
        report.missedMeetings,
        report.attendanceRate === null ? "" : Math.round(report.attendanceRate * 1000) / 1000,
        report.lastSeenAt ? formatLegacyDate(report.lastSeenAt.slice(0, 10)) : "",
        report.openSessionWarning ? "open check-in" : ""
      ])
    }
  };
}

function benchReportMeetingDates(range: BenchReportDateRange): string[] {
  if (benchHasScheduledMeetings()) {
    const rows = (db.prepare("SELECT meeting_date FROM scheduled_meetings WHERE required = 1 ORDER BY meeting_date").all() as Array<{ meeting_date: string }>)
      .filter((row) => isDateInRange(row.meeting_date, range));
    return [...new Set(rows.map((row) => row.meeting_date))];
  }
  return [...new Set(deriveBenchSessions().filter((session) => isDateInRange(session.meetingDate, range)).map((session) => session.meetingDate))].sort();
}

function benchHasScheduledMeetings(): boolean {
  return (db.prepare("SELECT COUNT(*) AS count FROM scheduled_meetings").get() as { count: number }).count > 0;
}

function benchReportDateRangeFromUrl(url: URL): BenchReportDateRange {
  const startDate = optionalBenchIsoDate(url.searchParams.get("startDate"), "startDate");
  const endDate = optionalBenchIsoDate(url.searchParams.get("endDate"), "endDate");
  if (startDate && endDate && startDate > endDate) throw httpError(400, "startDate must be on or before endDate");
  return { startDate, endDate };
}

function optionalBenchIsoDate(value: string | null, fieldName: string): string | undefined {
  if (value === null || value === "") return undefined;
  return requireIsoDate(value, fieldName);
}

function isDateInRange(meetingDate: string, range: BenchReportDateRange): boolean {
  if (range.startDate && meetingDate < range.startDate) return false;
  if (range.endDate && meetingDate > range.endDate) return false;
  return true;
}

function deriveBenchSessions(): AttendanceSession[] {
  const rows = db.prepare("SELECT id, student_id, occurred_at, status FROM scan_events WHERE status = 'accepted' ORDER BY occurred_at ASC").all() as Array<{
    id: string;
    student_id: string;
    occurred_at: string;
    status: "accepted";
  }>;
  return deriveAttendanceSessions(rows.map((row) => ({ id: row.id, memberId: row.student_id, occurredAt: row.occurred_at, status: row.status })));
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
  input: NormalizedKioskSyncEventInput,
  syncedAt: string,
  status: "accepted" | "duplicate" | "rejected",
  rejectionReason?: string
): ScanEvent {
  const id = `${kioskId}:${input.localEventId}`;
  db.prepare(`
    INSERT INTO scan_events (id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status, rejection_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, kioskId, input.localEventId, input.memberId, input.occurredAt, syncedAt, input.source, status, rejectionReason ?? null);
  return { id, kioskId, localEventId: input.localEventId, memberId: input.memberId, occurredAt: input.occurredAt, syncedAt, source: input.source, status };
}

function rowToScanEvent(row: DbScanEvent): ScanEvent {
  return {
    id: row.id,
    kioskId: row.kiosk_id,
    localEventId: row.local_event_id,
    memberId: row.student_id,
    occurredAt: row.occurred_at,
    syncedAt: row.synced_at,
    source: "fingerprint",
    status: row.status
  };
}

function rowToCommand(row: KioskCommandRow): KioskCommand {
  return {
    id: row.id,
    kioskId: row.kiosk_id,
    action: row.action as KioskCommandAction,
    status: row.status as KioskCommandStatus,
    requestedBy: row.requested_by ?? undefined,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    message: row.message ?? undefined
  };
}

function rowToScheduledMeeting(row: ScheduledMeetingRow): ScheduledMeeting {
  return {
    id: row.id,
    meetingDate: row.meeting_date,
    title: row.title,
    required: Boolean(row.required),
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-admin-email"
  };
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function requireNonEmptyString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) throw httpError(400, `${name} is required`);
  return value.trim();
}

function normalizeOptionalEmail(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw httpError(400, "email must be a string");
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw httpError(400, "email must be a valid email address");
  return trimmed;
}

interface ScheduledMeetingInput {
  meetingDate?: unknown;
  title?: unknown;
  required?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  notes?: unknown;
}

interface BulkScheduledMeetingDeleteInput {
  meetingIds?: unknown;
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

interface KioskCommandRow {
  id: string;
  kiosk_id: string;
  action: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  message: string | null;
}

interface ScheduledMeetingRow {
  id: string;
  meeting_date: string;
  title: string;
  required: number;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface KioskDisplayState {
  status: "ready" | "welcome" | "goodbye" | "duplicate" | "rejected" | "unknown";
  message: string;
  detail: string;
  updatedAt: string;
}

interface FingerprintEnrollmentRow {
  memberId: string;
  firstName?: string;
  lastName?: string;
  active: number;
  slot: number;
  fingerLabel?: string;
  enrolledAt: string;
}
