import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

describe("meeting absence notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews absent active members, missing emails, and disabled provider state", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Present", "Member", "present@example.org");
    insertStudent(env, "100002", "Absent", "Email", "absent@example.org");
    insertStudent(env, "100003", "Absent", "Missing", null);
    insertStudent(env, "999999", "Inactive", "Email", "inactive@example.org", 0);
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertSession(env, "100001", "2026-01-02");

    const response = await request(env, "/admin/notifications/meeting-absence", {
      meetingDate: "2026-01-02"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      meetingDate: "2026-01-02",
      title: "Required Build",
      notificationKind: "meeting_absence",
      providerConfigured: false,
      mode: "preview",
      sentCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      recipients: [{
        memberId: "100002",
        firstName: "Absent",
        lastName: "Email",
        email: "absent@example.org",
        status: "would_send"
      }],
      missingEmail: [{
        memberId: "100003",
        firstName: "Absent",
        lastName: "Missing",
        status: "missing_email"
      }]
    });
    expect(countRows(env, "notification_deliveries")).toBe(0);
  });

  it("rejects optional meetings", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Absent", "Member", "absent@example.org");
    insertMeeting(env, "2026-01-02", 0, "Optional Demo");

    const response = await request(env, "/admin/notifications/meeting-absence", {
      meetingDate: "2026-01-02"
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Only required meetings can send missed-meeting emails" });
  });

  it("rejects meetings that have not ended", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Absent", "Member", "absent@example.org");
    insertMeeting(
      env,
      "2099-01-02",
      1,
      "Future Build",
      "2099-01-02T20:00:00.000Z",
      "2099-01-02T22:00:00.000Z"
    );

    const response = await request(env, "/admin/notifications/meeting-absence", {
      meetingDate: "2099-01-02"
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Meeting must be completed before missed-meeting emails can be sent" });
  });

  it("stays preview-only when a Resend key is set without a from address", async () => {
    const env = createTestEnv({
      RESEND_API_KEY: "re_test-key"
    });
    insertStudent(env, "100001", "Absent", "Member", "absent@example.org");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(env, "/admin/notifications/meeting-absence", {
      meetingDate: "2026-01-02"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providerConfigured: false,
      mode: "preview",
      recipients: [{
        memberId: "100001",
        email: "absent@example.org",
        status: "would_send"
      }]
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(countRows(env, "notification_deliveries")).toBe(0);
  });

  it("sends through Resend and skips prior deliveries by default", async () => {
    const env = createTestEnv({
      RESEND_API_KEY: "re_test-key",
      EMAIL_FROM_ADDRESS: "attendance@example.org",
      EMAIL_FROM_NAME: "Team Attendance"
    });
    insertStudent(env, "100001", "Present", "Member", "present@example.org");
    insertStudent(env, "100002", "Already", "Sent", "already@example.org");
    insertStudent(env, "100003", "Needs", "Email", "needs@example.org");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertSession(env, "100001", "2026-01-02");
    insertDelivery(env, "100002", "already@example.org", "sent");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "provider-1" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(env, "/admin/notifications/meeting-absence", {
      meetingDate: "2026-01-02"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providerConfigured: true,
      mode: "send",
      sentCount: 1,
      skippedDuplicateCount: 1,
      recipients: [
        {
          memberId: "100003",
          email: "needs@example.org",
          status: "sent"
        },
        {
          memberId: "100002",
          email: "already@example.org",
          status: "skipped_duplicate"
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer re_test-key",
        "content-type": "application/json",
        "Idempotency-Key": "meeting_absence:2026-01-02:100003:needs@example.org"
      })
    }));
    const resendBody = fetchJsonBody(fetchMock);
    expect(resendBody).toMatchObject({
      from: "Team Attendance <attendance@example.org>",
      to: ["needs@example.org"],
      subject: "Missed meeting: Required Build"
    });
    expect(resendBody.html).toContain("Our attendance records show");
    expect(resendBody.text).toContain("Hi Needs,");
    expect(sentDeliveryEmails(env)).toEqual(["already@example.org", "needs@example.org"]);
    expect(providerMessageIds(env)).toEqual(["provider-1"]);
  });

  it("keeps backwards-compatible generic HTTP provider support", async () => {
    const env = createTestEnv({
      EMAIL_PROVIDER_URL: "https://email.test/send",
      EMAIL_PROVIDER_API_KEY: "test-key",
      EMAIL_FROM_ADDRESS: "attendance@example.org"
    });
    insertStudent(env, "100001", "Needs", "Email", "needs@example.org");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "generic-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(env, "/admin/notifications/meeting-absence", {
      meetingDate: "2026-01-02"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providerConfigured: true,
      mode: "send",
      sentCount: 1
    });
    expect(fetchMock).toHaveBeenCalledWith("https://email.test/send", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer test-key",
        "content-type": "application/json"
      })
    }));
    const genericBody = fetchJsonBody(fetchMock);
    expect(genericBody).toMatchObject({
      from: {
        email: "attendance@example.org",
        name: "FRC Attendance"
      },
      to: [{ email: "needs@example.org" }],
      metadata: {
        notificationKind: "meeting_absence",
        meetingDate: "2026-01-02",
        memberId: "100001"
      }
    });
    expect(providerMessageIds(env)).toEqual(["generic-1"]);
  });
});

describe("member attendance report notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews a member attendance report without writing audit rows", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Report", "Member", "report@example.org");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertMeeting(env, "2026-01-09", 1, "Required Shop");
    insertMeeting(env, "2026-01-10", 0, "Optional Demo");
    insertSession(env, "100001", "2026-01-02");
    insertSession(env, "100001", "2026-01-10");

    const response = await request(env, "/admin/notifications/member-attendance-report", {
      memberId: "100001",
      preview: true
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      memberId: "100001",
      firstName: "Report",
      lastName: "Member",
      email: "report@example.org",
      notificationKind: "member_attendance_report",
      providerConfigured: false,
      mode: "preview",
      sentCount: 0,
      recipient: {
        memberId: "100001",
        email: "report@example.org",
        status: "would_send"
      },
      report: {
        attendanceRate: 0.5,
        totalMeetings: 2,
        presentMeetings: 1,
        missedMeetings: 1,
        missedMeetingsList: [{ meetingDate: "2026-01-09", title: "Required Shop" }],
        optionalMeetings: [{ meetingDate: "2026-01-10", title: "Optional Demo", attended: true }]
      }
    });
    expect(countRows(env, "notification_deliveries")).toBe(0);
  });

  it("returns clear missing-email feedback for member reports", async () => {
    const env = createTestEnv({
      RESEND_API_KEY: "re_test-key",
      EMAIL_FROM_ADDRESS: "attendance@example.org"
    });
    insertStudent(env, "100001", "Missing", "Email", null);
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(env, "/admin/notifications/member-attendance-report", {
      memberId: "100001"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providerConfigured: true,
      mode: "send",
      recipient: null,
      sentCount: 0,
      missingEmail: [{
        memberId: "100001",
        firstName: "Missing",
        lastName: "Email",
        status: "missing_email"
      }]
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(countRows(env, "notification_deliveries")).toBe(0);
  });

  it("sends member attendance reports through Resend and skips same-day duplicates", async () => {
    const env = createTestEnv({
      RESEND_API_KEY: "re_test-key",
      EMAIL_FROM_ADDRESS: "attendance@example.org",
      EMAIL_FROM_NAME: "Team Attendance"
    });
    insertStudent(env, "100001", "Needs", "Report", "needs@example.org");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertMeeting(env, "2026-01-09", 1, "Required Shop");
    insertMeeting(env, "2026-01-10", 0, "Optional Demo");
    insertMeeting(env, "2099-01-02", 1, "Future Build", "2099-01-02T20:00:00.000Z", "2099-01-02T22:00:00.000Z");
    insertSession(env, "100001", "2026-01-02");
    insertSession(env, "100001", "2026-01-10");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "provider-report-1" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(env, "/admin/notifications/member-attendance-report", {
      memberId: "100001"
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { reportDate: string };
    expect(body).toMatchObject({
      providerConfigured: true,
      mode: "send",
      sentCount: 1,
      skippedDuplicateCount: 0,
      recipient: {
        memberId: "100001",
        email: "needs@example.org",
        status: "sent"
      },
      report: {
        attendanceRate: 0.5,
        totalMeetings: 2,
        presentMeetings: 1,
        missedMeetings: 1,
        missedMeetingsList: [{ meetingDate: "2026-01-09", title: "Required Shop" }],
        optionalMeetings: [{ meetingDate: "2026-01-10", title: "Optional Demo", attended: true }]
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer re_test-key",
        "content-type": "application/json",
        "Idempotency-Key": `member_attendance_report:${body.reportDate}:100001:needs@example.org`
      })
    }));
    const resendBody = fetchJsonBody(fetchMock);
    expect(resendBody).toMatchObject({
      from: "Team Attendance <attendance@example.org>",
      to: ["needs@example.org"],
      subject: "Attendance report for Needs Report"
    });
    expect(resendBody.text).toContain("Required attendance: 50%");
    expect(resendBody.text).toContain("Required Shop");
    expect(resendBody.text).toContain("Optional Demo (attended)");
    expect(resendBody.text).not.toContain("Future Build");

    const duplicateResponse = await request(env, "/admin/notifications/member-attendance-report", {
      memberId: "100001"
    });

    expect(duplicateResponse.status).toBe(200);
    expect(await duplicateResponse.json()).toMatchObject({
      sentCount: 0,
      skippedDuplicateCount: 1,
      recipient: {
        memberId: "100001",
        email: "needs@example.org",
        status: "skipped_duplicate"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentDeliveryEmails(env)).toEqual(["needs@example.org"]);
    expect(providerMessageIds(env)).toEqual(["provider-report-1"]);
  });
});

function createTestEnv(overrides: Partial<Env> = {}): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE admin_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'mentor',
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT
    );

    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      active INTEGER NOT NULL DEFAULT 1
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

    CREATE TABLE notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_kind TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      student_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      error_message TEXT,
      sent_at TEXT,
      error_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York",
    GOOGLE_ALLOWED_EMAILS: "mentor@example.com",
    GOOGLE_ALLOWED_DOMAIN: "",
    GOOGLE_CLIENT_ID: "",
    DUPLICATE_WINDOW_SECONDS: "90",
    ...overrides
  } as unknown as Env;
}

function request(env: Env, path: string, body: unknown) {
  return worker.fetch(new Request(`https://api.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-email": "mentor@example.com"
    },
    body: JSON.stringify(body)
  }), env);
}

function insertStudent(env: Env, memberId: string, firstName: string, lastName: string, email: string | null, active = 1) {
  return env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, email, active) VALUES (?, ?, ?, ?, ?)")
    .bind(memberId, firstName, lastName, email, active)
    .run();
}

function insertMeeting(
  env: Env,
  meetingDate: string,
  required = 1,
  title = `Meeting ${meetingDate}`,
  startsAt: string | null = null,
  endsAt: string | null = null
) {
  return env.DB.prepare(
    "INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    `meeting-${meetingDate}`,
    meetingDate,
    title,
    required,
    startsAt,
    endsAt,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  ).run();
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

function insertDelivery(env: Env, memberId: string, email: string, status: "sent" | "error", notificationKind = "meeting_absence", meetingDate = "2026-01-02") {
  return env.DB.prepare(`
    INSERT INTO notification_deliveries (
      id,
      notification_kind,
      meeting_date,
      student_id,
      recipient_email,
      status,
      sent_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `delivery-${memberId}`,
    notificationKind,
    meetingDate,
    memberId,
    email,
    status,
    status === "sent" ? "2026-01-03T00:00:00.000Z" : null,
    "2026-01-03T00:00:00.000Z",
    "2026-01-03T00:00:00.000Z"
  ).run();
}

function countRows(env: Env, table: string): number {
  const row = (env.DB as unknown as ReturnType<typeof d1>).sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function sentDeliveryEmails(env: Env): string[] {
  const rows = (env.DB as unknown as ReturnType<typeof d1>).sqlite.prepare(`
    SELECT recipient_email
    FROM notification_deliveries
    WHERE status = 'sent'
    ORDER BY recipient_email
  `).all() as Array<{ recipient_email: string }>;
  return rows.map((row) => row.recipient_email);
}

function providerMessageIds(env: Env): string[] {
  const rows = (env.DB as unknown as ReturnType<typeof d1>).sqlite.prepare(`
    SELECT provider_message_id
    FROM notification_deliveries
    WHERE provider_message_id IS NOT NULL
    ORDER BY provider_message_id
  `).all() as Array<{ provider_message_id: string }>;
  return rows.map((row) => row.provider_message_id);
}

function fetchJsonBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  if (!init || typeof init.body !== "string") throw new Error("Expected fetch JSON body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function d1(sqlite: Database.Database) {
  return {
    sqlite,
    prepare(sql: string) {
      return new TestStatement(sqlite, sql);
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
