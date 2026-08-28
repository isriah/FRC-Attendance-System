import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  attendanceContestCustomId,
  contestAttendanceAbsence,
  parseAttendanceContestCustomId,
  sendDiscordBotMissingMemberNotifications
} from "../src/discordAttendance";
import type { Env } from "../src/env";

describe("Discord bot attendance notifications", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends one bot message with explicit mentions and a contest button", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "890334748730351629",
      DISCORD_MISSING_MEMBER_DELAY_MINUTES: "30"
    });
    insertStudent(env, "100001", "Present", "Member", "111111111111111111");
    insertStudent(env, "100002", "Missing", "One", "222222222222222222");
    insertStudent(env, "100003", "Missing", "Two", "333333333333333333");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertSession(env, "100001", "2026-01-02");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "444444444444444444" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscordBotMissingMemberNotifications(env, { meetingDate: "2026-01-02" }, new Date("2026-01-02T22:30:00.000Z"));

    expect(result).toMatchObject({
      notificationKind: "discord_bot_missing_members",
      providerConfigured: true,
      mode: "send",
      delayMinutes: 30,
      eligibleAt: "2026-01-02T22:30:00.000Z",
      sentCount: 2,
      errorCount: 0
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/890334748730351629/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bot test-bot-token" })
      })
    );
    const payload = fetchBody(fetchMock);
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: ["222222222222222222", "333333333333333333"]
    });
    expect(payload.components).toEqual([{
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: "Contest absence",
        custom_id: "attendance-contest:v1:2026-01-02"
      }]
    }]);
    expect(String(payload.content)).toContain("<@222222222222222222> <@333333333333333333>");
    expect(deliveryMessageIds(env)).toEqual(["444444444444444444", "444444444444444444"]);
  });

  it("enforces the configured post-meeting delay", async () => {
    const env = createTestEnv({ DISCORD_MISSING_MEMBER_DELAY_MINUTES: "45" });
    insertStudent(env, "100001", "Missing", "Member", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");

    await expect(sendDiscordBotMissingMemberNotifications(
      env,
      { meetingDate: "2026-01-02", preview: true },
      new Date("2026-01-02T22:44:59.000Z")
    )).rejects.toThrow("delayed until 2026-01-02T22:45:00.000Z");
  });

  it("strictly validates contest custom IDs", () => {
    expect(attendanceContestCustomId("2026-01-02")).toBe("attendance-contest:v1:2026-01-02");
    expect(parseAttendanceContestCustomId("attendance-contest:v1:2026-01-02")).toEqual({ meetingDate: "2026-01-02" });
    expect(parseAttendanceContestCustomId("attendance-contest:v1:2026-99-99")).toBeNull();
    expect(parseAttendanceContestCustomId("other:v1:2026-01-02")).toBeNull();
    expect(parseAttendanceContestCustomId("attendance-contest:v1:2026-01-02:100001")).toBeNull();
  });
});

describe("attendance contest lifecycle", () => {
  it("matches the clicking member to the delivered message and creates one pending contest idempotently", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertStudent(env, "100002", "Grace", "Hopper", "222222222222222222");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");

    const first = await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111"));
    const repeated = await contestAttendanceAbsence(env, contestInput("555555555555555552", "111111111111111111"));
    const wrongMember = await contestAttendanceAbsence(env, contestInput("555555555555555553", "222222222222222222"));

    expect(first).toMatchObject({ status: "created", contest: { memberId: "100001", status: "pending" } });
    expect(repeated).toMatchObject({ status: "already_pending", contest: { memberId: "100001", status: "pending" } });
    if (first.status === "created" && repeated.status === "already_pending") {
      expect(repeated.contest.id).toBe(first.contest.id);
    }
    expect(wrongMember).toEqual({ status: "not_eligible" });
    expect(countRows(env, "attendance_contests")).toBe(1);
  });

  it("does not create a contest when attendance already shows the member present", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");
    insertSession(env, "100001", "2026-01-02");

    expect(await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111")))
      .toEqual({ status: "already_present" });
    expect(countRows(env, "attendance_contests")).toBe(0);
  });

  it("lets authenticated admins list and review contests without changing attendance", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", "111111111111111111");
    insertMeeting(env, "2026-01-02", "2026-01-02T22:00:00.000Z");
    insertDelivery(env, "100001", "111111111111111111", "444444444444444444");
    const created = await contestAttendanceAbsence(env, contestInput("555555555555555551", "111111111111111111"));
    if (created.status !== "created") throw new Error("Expected a created contest");

    const listResponse = await adminRequest(env, "GET", "/admin/attendance-contests?status=pending");
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      contests: [{
        id: created.contest.id,
        memberId: "100001",
        firstName: "Ada",
        lastName: "Lovelace",
        meetingDate: "2026-01-02",
        status: "pending"
      }]
    });

    const reviewResponse = await adminRequest(env, "PUT", `/admin/attendance-contests/${created.contest.id}`, {
      status: "resolved",
      reviewNote: "Added a manual check-in after confirming with the drive coach."
    });
    expect(reviewResponse.status).toBe(200);
    expect(await reviewResponse.json()).toMatchObject({
      id: created.contest.id,
      status: "resolved",
      reviewedByAdminEmail: "mentor@example.com",
      reviewNote: "Added a manual check-in after confirming with the drive coach."
    });
    expect(countRows(env, "attendance_sessions")).toBe(0);
  });
});

function contestInput(interactionId: string, discordUserId: string) {
  return {
    interactionId,
    discordUserId,
    customId: "attendance-contest:v1:2026-01-02",
    sourceMessageId: "444444444444444444",
    sourceChannelId: "890334748730351629"
  };
}

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
      discord_user_id TEXT,
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
    CREATE TABLE attendance_contests (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(student_id),
      scheduled_meeting_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL UNIQUE,
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

function insertStudent(env: Env, memberId: string, firstName: string, lastName: string, discordUserId: string | null) {
  return env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, discord_user_id, active) VALUES (?, ?, ?, ?, 1)")
    .bind(memberId, firstName, lastName, discordUserId)
    .run();
}

function insertMeeting(env: Env, meetingDate: string, endsAt: string) {
  return env.DB.prepare(`
    INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).bind(
    `meeting-${meetingDate}`,
    meetingDate,
    "Required Build",
    `${meetingDate}T20:00:00.000Z`,
    endsAt,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  ).run();
}

function insertSession(env: Env, memberId: string, meetingDate: string) {
  return env.DB.prepare(`
    INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, status, source_event_ids, rebuilt_at)
    VALUES (?, ?, ?, ?, 'open', '[]', ?)
  `).bind(`session-${memberId}-${meetingDate}`, memberId, meetingDate, `${meetingDate}T20:00:00.000Z`, new Date().toISOString()).run();
}

function insertDelivery(env: Env, memberId: string, discordUserId: string, providerMessageId: string) {
  const now = "2026-01-02T22:30:00.000Z";
  return env.DB.prepare(`
    INSERT INTO notification_deliveries (
      id, notification_kind, meeting_date, student_id, recipient_email, status,
      provider_message_id, sent_at, created_at, updated_at
    ) VALUES (?, 'discord_bot_missing_members', '2026-01-02', ?, ?, 'sent', ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), memberId, discordUserId, providerMessageId, now, now, now).run();
}

function adminRequest(env: Env, method: string, path: string, body?: unknown) {
  return worker.fetch(new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-admin-email": "mentor@example.com" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
}

function fetchBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  if (!init || typeof init.body !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function deliveryMessageIds(env: Env): string[] {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  const rows = db.sqlite.prepare("SELECT provider_message_id FROM notification_deliveries ORDER BY student_id").all() as Array<{ provider_message_id: string }>;
  return rows.map((row) => row.provider_message_id);
}

function countRows(env: Env, table: string): number {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  return (db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
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
