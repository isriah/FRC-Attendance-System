import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

describe("scheduled meeting admin API", () => {
  it("creates, lists, updates, and deletes scheduled meetings", async () => {
    const env = createTestEnv();

    const created = await request(env, "POST", "/admin/meetings", {
      meetingDate: "2026-01-02",
      title: "Build season kickoff",
      required: true,
      startsAt: "2026-01-02T20:00:00.000Z",
      endsAt: "2026-01-02T22:00:00.000Z",
      notes: "Bring laptops"
    });

    expect(created.status).toBe(201);
    const createdBody = await created.json() as { id: string; meetingDate: string; required: boolean };
    expect(createdBody).toMatchObject({
      meetingDate: "2026-01-02",
      required: true
    });
    expect(createdBody.id).toBeTruthy();

    const listed = await request(env, "GET", "/admin/meetings");
    expect(await listed.json()).toMatchObject({
      meetings: [{
        id: createdBody.id,
        meetingDate: "2026-01-02",
        title: "Build season kickoff",
        required: true,
        startsAt: "2026-01-02T20:00:00.000Z",
        endsAt: "2026-01-02T22:00:00.000Z",
        notes: "Bring laptops"
      }]
    });

    const updated = await request(env, "PUT", `/admin/meetings/${createdBody.id}`, {
      meetingDate: "2026-01-03",
      title: "Optional shop cleanup",
      required: false
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: createdBody.id,
      meetingDate: "2026-01-03",
      title: "Optional shop cleanup",
      required: false
    });

    const deleted = await request(env, "DELETE", `/admin/meetings/${createdBody.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await request(env, "GET", "/admin/meetings");
    expect(await afterDelete.json()).toEqual({ meetings: [] });
  });

  it("rejects duplicate scheduled meeting dates", async () => {
    const env = createTestEnv();

    await request(env, "POST", "/admin/meetings", {
      meetingDate: "2026-01-02",
      title: "Practice"
    });
    const duplicate = await request(env, "POST", "/admin/meetings", {
      meetingDate: "2026-01-02",
      title: "Second practice"
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "Scheduled meeting already exists for 2026-01-02" });
  });

  it("rejects meeting times that fall outside the scheduled meeting date", async () => {
    const env = createTestEnv();

    const response = await request(env, "POST", "/admin/meetings", {
      meetingDate: "2026-01-02",
      title: "Regular Meeting",
      startsAt: "2026-01-02T20:00:00.000Z",
      endsAt: "2026-01-03T22:30:00.000Z"
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "endsAt must be on meetingDate" });
  });

  it("bulk deletes selected scheduled meetings without touching unselected meetings", async () => {
    const env = createTestEnv();

    const first = await createMeeting(env, "2026-01-02", "Practice 1");
    const second = await createMeeting(env, "2026-01-03", "Practice 2");
    await createMeeting(env, "2026-01-04", "Practice 3");

    const deleted = await request(env, "POST", "/admin/meetings/bulk-delete", {
      meetingIds: [first.id, second.id, first.id]
    });

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: 2 });

    const afterDelete = await request(env, "GET", "/admin/meetings");
    expect(await afterDelete.json()).toMatchObject({
      meetings: [{
        meetingDate: "2026-01-04",
        title: "Practice 3"
      }]
    });
  });

  it("rejects empty bulk delete selections", async () => {
    const env = createTestEnv();

    const response = await request(env, "POST", "/admin/meetings/bulk-delete", {
      meetingIds: []
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Select at least one scheduled meeting" });
  });

  it("converts an unscheduled attendance date into a scheduled meeting", async () => {
    const env = createTestEnv();
    insertSession(env, "100001", "2026-01-05");

    const response = await request(env, "POST", "/admin/meetings/convert-unscheduled", {
      meetingDate: "2026-01-05",
      title: "Build lab",
      required: false,
      startsAt: "2026-01-05T20:00:00.000Z",
      endsAt: "2026-01-05T22:00:00.000Z"
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      meetingDate: "2026-01-05",
      title: "Build lab",
      required: false
    });

    const listed = await request(env, "GET", "/admin/meetings");
    expect(await listed.json()).toMatchObject({
      meetings: [{
        meetingDate: "2026-01-05",
        title: "Build lab",
        required: false
      }]
    });
  });

  it("clears attendance source data for a local date without deleting scheduled meetings", async () => {
    const env = createTestEnv();
    await createMeeting(env, "2026-01-05", "Keep scheduled meeting");
    insertScanEvent(env, "scan-keep", "100001", "2026-01-04T20:00:00.000Z");
    insertScanEvent(env, "scan-clear", "100001", "2026-01-05T20:00:00.000Z");
    insertManualEvent(env, "manual-clear", "100001", "2026-01-05T21:00:00.000Z");
    await env.DB.prepare("INSERT INTO attendance_exclusions (id, student_id, meeting_date, reason, admin_email) VALUES ('exclude-clear', '100001', '2026-01-05', 'test correction', 'mentor@example.com')").run();
    insertSession(env, "100001", "2026-01-04");
    insertSession(env, "100001", "2026-01-05");

    const rejected = await request(env, "POST", "/admin/attendance/clear-date", {
      meetingDate: "2026-01-05",
      confirmation: "CLEAR"
    });
    expect(rejected.status).toBe(400);

    const cleared = await request(env, "POST", "/admin/attendance/clear-date", {
      meetingDate: "2026-01-05",
      confirmation: "CLEAR 2026-01-05"
    });

    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      meetingDate: "2026-01-05",
      deletedScanEvents: 1,
      deletedManualEvents: 1,
      deletedAttendanceExclusions: 1
    });

    expect(countRows(env, "scheduled_meetings")).toBe(1);
    expect(countRows(env, "scan_events")).toBe(1);
    expect(countRows(env, "manual_events")).toBe(0);
    expect(countRows(env, "attendance_exclusions")).toBe(0);
    expect(sessionDates(env)).toEqual(["2026-01-04"]);
  });

  it("requires admin auth to remove one present member and writes an audited exclusion", async () => {
    const env = createTestEnv();
    insertScanEvent(env, "scan-remove", "100001", "2026-01-05T20:00:00.000Z");
    insertSession(env, "100001", "2026-01-05");
    const body = {
      memberId: "100001",
      meetingDate: "2026-01-05",
      reason: "Confirmed wrong-member scan"
    };

    const unauthorized = await worker.fetch(new Request("https://api.test/admin/attendance/remove-member", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }), env);
    expect(unauthorized.status).toBe(401);
    expect(countRows(env, "attendance_exclusions")).toBe(0);

    const removed = await request(env, "POST", "/admin/attendance/remove-member", body);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      memberId: "100001",
      meetingDate: "2026-01-05",
      reason: "Confirmed wrong-member scan",
      adminEmail: "mentor@example.com"
    });
    expect(countRows(env, "scan_events")).toBe(1);
    expect(countRows(env, "attendance_sessions")).toBe(0);
    expect(countRows(env, "attendance_exclusions")).toBe(1);
  });

  it("requires admin auth, exact confirmation, and a debugging note to clear one member's meeting source data", async () => {
    const env = createTestEnv();
    await createMeeting(env, "2026-01-05", "Debug meeting");
    insertScanEvent(env, "scan-clear", "100001", "2026-01-05T20:00:00.000Z");
    insertSession(env, "100001", "2026-01-05");
    const body = {
      memberId: "100001",
      meetingDate: "2026-01-05",
      reason: "Bad sensor mapping during debug",
      confirmation: "CLEAR 100001 2026-01-05"
    };

    const unauthorized = await worker.fetch(new Request("https://api.test/admin/attendance/clear-member-source-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }), env);
    expect(unauthorized.status).toBe(401);
    expect(countRows(env, "scan_events")).toBe(1);

    const badConfirmation = await request(env, "POST", "/admin/attendance/clear-member-source-data", {
      ...body,
      confirmation: "CLEAR 2026-01-05"
    });
    expect(badConfirmation.status).toBe(400);
    expect(countRows(env, "scan_events")).toBe(1);

    const badReason = await request(env, "POST", "/admin/attendance/clear-member-source-data", {
      ...body,
      reason: "debug"
    });
    expect(badReason.status).toBe(400);
    expect(countRows(env, "scan_events")).toBe(1);
  });

  it("clears only the selected member's scheduled-meeting source data and preserves audit history and exclusions", async () => {
    const env = createTestEnv();
    await createMeeting(env, "2026-01-05", "Debug meeting");
    await createMeeting(env, "2026-01-06", "Next meeting");
    await env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES ('100002', 'Other', 'Member', 1)").run();
    insertScanEvent(env, "scan-clear-in", "100001", "2026-01-05T20:00:00.000Z");
    insertScanEvent(env, "scan-clear-out", "100001", "2026-01-05T21:00:00.000Z");
    insertScanEvent(env, "scan-other-member", "100002", "2026-01-05T20:05:00.000Z");
    insertScanEvent(env, "scan-other-date", "100001", "2026-01-06T20:00:00.000Z");
    insertManualEvent(env, "manual-clear", "100001", "2026-01-05T21:30:00.000Z");
    insertManualEvent(env, "manual-other-member", "100002", "2026-01-05T21:30:00.000Z");
    insertManualEvent(env, "manual-other-date", "100001", "2026-01-06T21:30:00.000Z");
    await env.DB.prepare("INSERT INTO attendance_exclusions (id, student_id, meeting_date, reason, admin_email) VALUES ('exclude-preserve', '100001', '2026-01-05', 'prior audited correction', 'mentor@example.com')").run();
    insertNotificationDelivery(env, "delivery-preserve", "100001", "2026-01-05");
    insertAttendanceContest(env, "contest-preserve", "100001", "2026-01-05");

    const cleared = await request(env, "POST", "/admin/attendance/clear-member-source-data", {
      memberId: "100001",
      meetingDate: "2026-01-05",
      reason: "Removing incorrect debug enrollment scan",
      confirmation: "CLEAR 100001 2026-01-05"
    });

    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      memberId: "100001",
      meetingDate: "2026-01-05",
      deletedScanEvents: 2,
      deletedManualEvents: 1,
      deletedAttendanceExclusions: 0,
      preservedAuditHistory: true,
      preservedAttendanceExclusions: true
    });
    expect(eventIds(env, "scan_events")).toEqual(["scan-other-date", "scan-other-member"]);
    expect(eventIds(env, "manual_events")).toEqual(["manual-other-date", "manual-other-member"]);
    expect(countRows(env, "attendance_exclusions")).toBe(1);
    expect(countRows(env, "notification_deliveries")).toBe(1);
    expect(countRows(env, "attendance_contests")).toBe(1);
    expect([...new Set(sessionKeys(env))]).toEqual(["100001:2026-01-06", "100002:2026-01-05"]);

    const absenceReport = await request(env, "GET", "/admin/reports/meeting-absences?date=2026-01-05");
    expect(absenceReport.status).toBe(200);
    expect(await absenceReport.json()).toMatchObject({
      meetingDate: "2026-01-05",
      absentCount: 1,
      rows: [{ memberId: "100001", firstName: "Test", lastName: "Member" }]
    });
  });
});

async function createMeeting(env: Env, meetingDate: string, title: string) {
  const response = await request(env, "POST", "/admin/meetings", { meetingDate, title });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string; meetingDate: string; title: string }>;
}

function createTestEnv(): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE admin_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'mentor',
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT
    );

    CREATE TABLE scheduled_meetings (
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

    CREATE TABLE discord_scheduled_event_mappings (
      scheduled_meeting_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      discord_event_id TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'synced',
      attempts INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE scan_events (
      id TEXT PRIMARY KEY,
      kiosk_id TEXT NOT NULL,
      local_event_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      rejection_reason TEXT
    );

    CREATE TABLE manual_events (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      admin_email TEXT NOT NULL
    );

    CREATE TABLE attendance_sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      check_in_at TEXT NOT NULL,
      check_out_at TEXT,
      status TEXT NOT NULL,
      source_event_ids TEXT NOT NULL,
      rebuilt_at TEXT NOT NULL
    );

    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE attendance_exclusions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      admin_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      superseded_at TEXT,
      superseded_by_admin_email TEXT,
      superseded_reason TEXT
    );
    CREATE UNIQUE INDEX attendance_exclusions_active_member_date_unique_idx
    ON attendance_exclusions(student_id, meeting_date)
    WHERE superseded_at IS NULL;

    CREATE TABLE notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_kind TEXT NOT NULL,
      meeting_date TEXT,
      student_id TEXT,
      recipient_email TEXT NOT NULL,
      provider_message_id TEXT,
      status TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE attendance_contests (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      scheduled_meeting_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      source_message_id TEXT,
      source_channel_id TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by_admin_email TEXT,
      review_note TEXT
    );
    CREATE UNIQUE INDEX attendance_contests_member_meeting_unique_idx
    ON attendance_contests(student_id, scheduled_meeting_id);
  `);
  sqlite.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES ('100001', 'Test', 'Member', 1)").run();

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York",
    GOOGLE_ALLOWED_EMAILS: "mentor@example.com",
    GOOGLE_ALLOWED_DOMAIN: "",
    GOOGLE_CLIENT_ID: "",
    DUPLICATE_WINDOW_SECONDS: "90"
  } as unknown as Env;
}

function insertSession(env: Env, memberId: string, meetingDate: string) {
  return env.DB.prepare(
    "INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, check_out_at, status, source_event_ids, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    `session-${memberId}-${meetingDate}`,
    memberId,
    meetingDate,
    `${meetingDate}T20:00:00.000Z`,
    null,
    "open",
    "[]",
    "2026-01-10T00:00:00.000Z"
  ).run();
}

function insertScanEvent(env: Env, id: string, memberId: string, occurredAt: string) {
  return env.DB.prepare(
    "INSERT INTO scan_events (id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, "bench-01", id, memberId, occurredAt, `${occurredAt.slice(0, -1)}1Z`, "fingerprint", "accepted").run();
}

function insertManualEvent(env: Env, id: string, memberId: string, occurredAt: string) {
  return env.DB.prepare(
    "INSERT INTO manual_events (id, student_id, occurred_at, action, reason, admin_email) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, memberId, occurredAt, "check_in", "test", "mentor@example.com").run();
}

function countRows(env: Env, table: string): number {
  const row = (env.DB as unknown as ReturnType<typeof d1>).sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function sessionDates(env: Env): string[] {
  const rows = (env.DB as unknown as ReturnType<typeof d1>).sqlite.prepare("SELECT meeting_date FROM attendance_sessions ORDER BY meeting_date").all() as Array<{ meeting_date: string }>;
  return rows.map((row) => row.meeting_date);
}

function sessionKeys(env: Env): string[] {
  const rows = (env.DB as unknown as ReturnType<typeof d1>).sqlite.prepare("SELECT student_id, meeting_date FROM attendance_sessions ORDER BY student_id, meeting_date").all() as Array<{ student_id: string; meeting_date: string }>;
  return rows.map((row) => `${row.student_id}:${row.meeting_date}`);
}

function eventIds(env: Env, table: "scan_events" | "manual_events"): string[] {
  const rows = (env.DB as unknown as ReturnType<typeof d1>).sqlite.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function insertNotificationDelivery(env: Env, id: string, memberId: string, meetingDate: string) {
  return env.DB.prepare(`
    INSERT INTO notification_deliveries (
      id, notification_kind, meeting_date, student_id, recipient_email, provider_message_id, status, sent_at
    ) VALUES (?, 'meeting_absence', ?, ?, 'member@example.com', 'provider-1', 'sent', '2026-01-06T00:00:00.000Z')
  `).bind(id, meetingDate, memberId).run();
}

function insertAttendanceContest(env: Env, id: string, memberId: string, meetingDate: string) {
  return env.DB.prepare(`
    INSERT INTO attendance_contests (
      id, student_id, discord_user_id, scheduled_meeting_id, meeting_date, source_message_id, source_channel_id, reason, status, created_at
    ) VALUES (?, ?, '123456789', (SELECT id FROM scheduled_meetings WHERE meeting_date = ?), ?, 'message-1', 'channel-1', 'debug contest', 'pending', '2026-01-06T00:00:00.000Z')
  `).bind(id, memberId, meetingDate, meetingDate).run();
}

function request(env: Env, method: string, path: string, body?: unknown) {
  return worker.fetch(new Request(`https://api.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-email": "mentor@example.com"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
}

function d1(sqlite: Database.Database) {
  return {
    sqlite,
    prepare(sql: string) {
      return new TestStatement(sqlite, sql);
    },
    async batch(statements: TestStatement[]) {
      const transaction = sqlite.transaction(() => {
        for (const statement of statements) statement.run();
      });
      transaction();
      return [];
    }
  };
}

class TestStatement {
  private params: unknown[] = [];

  constructor(private readonly sqlite: Database.Database, private readonly sql: string) {}

  bind(...params: unknown[]) {
    const next = new TestStatement(this.sqlite, this.sql);
    next.params = params;
    return next;
  }

  async first<T>() {
    return this.sqlite.prepare(this.sql).get(...this.params) as T | null;
  }

  async all<T>() {
    return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] };
  }

  async run() {
    return this.sqlite.prepare(this.sql).run(...this.params);
  }
}
