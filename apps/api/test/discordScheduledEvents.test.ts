import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDiscordScheduledEventPayload, syncDiscordScheduledEvents } from "../src/discordScheduledEvents";
import worker from "../src/index";
import type { Env } from "../src/env";

describe("Discord scheduled event sync", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds external scheduled-event payloads from local meeting times", () => {
    const payload = buildDiscordScheduledEventPayload({
      id: "meeting-1",
      meeting_date: "2026-01-02",
      title: "Build Season Kickoff",
      required: 1,
      starts_at: "15:00",
      ends_at: "17:30",
      notes: "Bring laptops"
    }, "America/New_York");

    expect(payload).toEqual({
      channel_id: null,
      name: "Build Season Kickoff",
      privacy_level: 2,
      scheduled_start_time: "2026-01-02T20:00:00.000Z",
      scheduled_end_time: "2026-01-02T22:30:00.000Z",
      description: "Bring laptops\n\nAttendance: required",
      entity_type: 3,
      entity_metadata: { location: "Central High School" }
    });
  });

  it("requires admin auth for dashboard sync", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_GUILD_ID: "123456789012345678"
    });
    insertMeeting(env, "meeting-1", "2026-01-02");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(new Request("https://api.test/admin/meetings/discord/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetingIds: ["meeting-1"] })
    }), env);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mappingRows(env)).toEqual([]);
  });

  it("creates one external Discord event and stores the local mapping", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_ATTENDANCE_CHANNEL_ID: "444444444444444444"
    });
    insertMeeting(env, "meeting-1", "2026-01-02");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ guild_id: "123456789012345678" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "999999999999999999", guild_id: "123456789012345678" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncDiscordScheduledEvents(env, { meetingIds: ["meeting-1"] });

    expect(result).toMatchObject({
      notificationKind: "discord_scheduled_event_sync",
      providerConfigured: true,
      guildId: "123456789012345678",
      location: "Central High School",
      syncedCount: 1,
      createdCount: 1,
      updatedCount: 0,
      errorCount: 0,
      meetings: [{ meetingId: "meeting-1", status: "created", discordEventId: "999999999999999999" }]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/444444444444444444",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/guilds/123456789012345678/scheduled-events",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchBodyAt(fetchMock, 1)).toMatchObject({
      channel_id: null,
      name: "Regular Meeting",
      entity_type: 3,
      entity_metadata: { location: "Central High School" }
    });
    expect(mappingRows(env)).toMatchObject([{
      scheduled_meeting_id: "meeting-1",
      guild_id: "123456789012345678",
      discord_event_id: "999999999999999999",
      status: "synced",
      attempts: 1,
      last_error: null
    }]);
  });

  it("bulk sync creates unmapped meetings and updates existing mapped meetings", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_GUILD_ID: "123456789012345678"
    });
    insertMeeting(env, "meeting-1", "2026-01-02");
    insertMeeting(env, "meeting-2", "2026-01-03");
    insertMapping(env, "meeting-1", "123456789012345678", "888888888888888888");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "888888888888888888" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "999999999999999999" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await adminRequest(env, "POST", "/admin/meetings/discord/sync", {
      meetingIds: ["meeting-1", "meeting-2", "meeting-1"]
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      syncedCount: 2,
      createdCount: 1,
      updatedCount: 1,
      errorCount: 0,
      meetings: [
        { meetingId: "meeting-1", status: "updated", discordEventId: "888888888888888888" },
        { meetingId: "meeting-2", status: "created", discordEventId: "999999999999999999" }
      ]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/guilds/123456789012345678/scheduled-events/888888888888888888",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/guilds/123456789012345678/scheduled-events",
      expect.objectContaining({ method: "POST" })
    );
    expect(mappingRows(env).map((row) => ({
      scheduled_meeting_id: row.scheduled_meeting_id,
      discord_event_id: row.discord_event_id,
      attempts: row.attempts,
      status: row.status
    }))).toEqual([
      { scheduled_meeting_id: "meeting-1", discord_event_id: "888888888888888888", attempts: 2, status: "synced" },
      { scheduled_meeting_id: "meeting-2", discord_event_id: "999999999999999999", attempts: 1, status: "synced" }
    ]);
  });

  it("records update errors on existing mappings and retries safely", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_GUILD_ID: "123456789012345678"
    });
    insertMeeting(env, "meeting-1", "2026-01-02");
    insertMapping(env, "meeting-1", "123456789012345678", "888888888888888888");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary Discord failure", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "888888888888888888" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await syncDiscordScheduledEvents(env, { meetingIds: ["meeting-1"] });
    const second = await syncDiscordScheduledEvents(env, { meetingIds: ["meeting-1"] });

    expect(first).toMatchObject({
      syncedCount: 0,
      errorCount: 1,
      meetings: [{ meetingId: "meeting-1", status: "error", error: "temporary Discord failure" }]
    });
    expect(second).toMatchObject({
      syncedCount: 1,
      updatedCount: 1,
      errorCount: 0,
      meetings: [{ meetingId: "meeting-1", status: "updated", discordEventId: "888888888888888888" }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mappingRows(env)).toMatchObject([{
      scheduled_meeting_id: "meeting-1",
      status: "synced",
      attempts: 3,
      last_error: null
    }]);
  });

  it("returns per-meeting errors without calling Discord for invalid meetings", async () => {
    const env = createTestEnv({
      DISCORD_BOT_TOKEN: "test-bot-token",
      DISCORD_GUILD_ID: "123456789012345678"
    });
    insertMeeting(env, "meeting-1", "2026-01-02");
    await env.DB.prepare("UPDATE scheduled_meetings SET ends_at = NULL WHERE id = 'meeting-1'").run();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncDiscordScheduledEvents(env, { meetingIds: ["meeting-1", "missing-meeting"] });

    expect(result).toMatchObject({
      syncedCount: 0,
      errorCount: 2,
      meetings: [
        { meetingId: "meeting-1", status: "error", error: "endsAt is required for Discord scheduled events" },
        { meetingId: "missing-meeting", status: "error", error: "Scheduled meeting not found" }
      ]
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mappingRows(env)).toEqual([]);
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

function insertMeeting(env: Env, id: string, meetingDate: string) {
  return env.DB.prepare(`
    INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, notes, created_at, updated_at)
    VALUES (?, ?, 'Regular Meeting', 1, ?, ?, 'Bring laptops', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).bind(id, meetingDate, `${meetingDate}T20:00:00.000Z`, `${meetingDate}T22:30:00.000Z`).run();
}

function insertMapping(env: Env, meetingId: string, guildId: string, eventId: string) {
  return env.DB.prepare(`
    INSERT INTO discord_scheduled_event_mappings (
      scheduled_meeting_id, guild_id, discord_event_id, location, status, attempts,
      last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'Central High School', 'synced', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).bind(meetingId, guildId, eventId).run();
}

function adminRequest(env: Env, method: string, path: string, body?: unknown) {
  return worker.fetch(new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-admin-email": "mentor@example.com" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
}

function mappingRows(env: Env): Array<{
  scheduled_meeting_id: string;
  guild_id: string;
  discord_event_id: string;
  location: string;
  status: string;
  attempts: number;
  last_error: string | null;
}> {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  return db.sqlite.prepare(`
    SELECT scheduled_meeting_id, guild_id, discord_event_id, location, status, attempts, last_error
    FROM discord_scheduled_event_mappings
    ORDER BY scheduled_meeting_id
  `).all() as Array<{
    scheduled_meeting_id: string;
    guild_id: string;
    discord_event_id: string;
    location: string;
    status: string;
    attempts: number;
    last_error: string | null;
  }>;
}

function fetchBodyAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  if (!init || typeof init.body !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function d1(sqlite: Database.Database) {
  return {
    sqlite,
    prepare(sql: string) {
      return new TestStatement(sqlite, sql);
    },
    async batch(statements: TestStatement[]) {
      const transaction = sqlite.transaction(() => statements.map((statement) => statement.run()));
      return transaction();
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
