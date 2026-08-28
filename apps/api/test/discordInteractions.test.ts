import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

let privateKey: CryptoKey;
let publicKeyHex: string;

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  privateKey = keyPair.privateKey;
  publicKeyHex = bytesToHex(new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)));
});

describe("Discord interactions", () => {
  it("rejects requests without a valid Discord signature", async () => {
    const env = createTestEnv();
    const response = await worker.fetch(new Request("https://api.test/discord/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "00".repeat(64),
        "x-signature-timestamp": "1700000000"
      },
      body: JSON.stringify({ type: 1 })
    }), env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid request signature" });
  });

  it("answers a signed Discord PING with PONG", async () => {
    const env = createTestEnv();
    const response = await signedRequest(env, { type: 1 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("links the invoking Discord user to an active member and responds ephemerally", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace");

    const response = await signedRequest(env, linkCommand("100001", "111111111111111111"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      type: 4,
      data: {
        content: "Linked your Discord account to Ada Lovelace (member ID 100001).",
        flags: 64
      }
    });
    expect(discordIdFor(env, "100001")).toBe("111111111111111111");
  });

  it("treats a repeated link from the same Discord user as idempotent", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", 1, "111111111111111111");

    const response = await signedRequest(env, linkCommand("100001", "111111111111111111"));

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("already linked to member ID 100001") }
    });
    expect(discordIdFor(env, "100001")).toBe("111111111111111111");
  });

  it("does not report success when a concurrent edit claims the member first", async () => {
    let raced = false;
    const env = createTestEnv((sql, sqlite) => {
      if (!raced && sql.includes("UPDATE students SET discord_user_id")) {
        raced = true;
        sqlite.prepare("UPDATE students SET discord_user_id = ? WHERE student_id = ?")
          .run("222222222222222222", "100001");
      }
    });
    insertStudent(env, "100001", "Ada", "Lovelace");

    const response = await signedRequest(env, linkCommand("100001", "111111111111111111"));

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("already linked to a different Discord account") }
    });
    expect(discordIdFor(env, "100001")).toBe("222222222222222222");
  });

  it("keeps not-found and inactive member responses private without changing the roster", async () => {
    const env = createTestEnv();
    insertStudent(env, "100002", "Inactive", "Member", 0);

    const missingResponse = await signedRequest(env, linkCommand("missing", "111111111111111111"));
    const inactiveResponse = await signedRequest(env, linkCommand("100002", "111111111111111111"));

    expect(await missingResponse.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("No attendance member was found") }
    });
    expect(await inactiveResponse.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("is inactive") }
    });
    expect(discordIdFor(env, "100002")).toBeNull();
  });

  it("does not overwrite either side of an existing Discord link", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Already", "Linked", 1, "222222222222222222");
    insertStudent(env, "100002", "Other", "Member");

    const memberConflict = await signedRequest(env, linkCommand("100001", "111111111111111111"));
    const discordConflict = await signedRequest(env, linkCommand("100002", "222222222222222222"));

    expect(await memberConflict.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("already linked to a different Discord account") }
    });
    expect(await discordConflict.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("already linked to member ID 100001") }
    });
    expect(discordIdFor(env, "100001")).toBe("222222222222222222");
    expect(discordIdFor(env, "100002")).toBeNull();
  });

  it("records contest button clicks idempotently and responds ephemerally", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Ada", "Lovelace", 1, "111111111111111111");
    insertMeetingAndDelivery(env, "100001", "111111111111111111");

    const first = await signedRequest(env, contestButton("555555555555555551", "111111111111111111"));
    const repeated = await signedRequest(env, contestButton("555555555555555552", "111111111111111111"));

    expect(await first.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("recorded for mentor review") }
    });
    expect(await repeated.json()).toMatchObject({
      type: 4,
      data: { flags: 64, content: expect.stringContaining("already have a pending") }
    });
    expect(countContests(env)).toBe(1);
  });
});

function linkCommand(memberId: string, discordUserId: string) {
  return {
    id: crypto.randomUUID(),
    type: 2,
    member: { user: { id: discordUserId } },
    data: {
      name: "link-attendance",
      options: [{ type: 3, name: "member_id", value: memberId }]
    }
  };
}

function contestButton(interactionId: string, discordUserId: string) {
  return {
    id: interactionId,
    type: 3,
    channel_id: "890334748730351629",
    member: { user: { id: discordUserId } },
    message: { id: "444444444444444444" },
    data: { custom_id: "attendance-contest:v1:2026-01-02" }
  };
}

async function signedRequest(env: Env, body: unknown) {
  const rawBody = JSON.stringify(body);
  const timestamp = "1700000000";
  const message = new TextEncoder().encode(timestamp + rawBody);
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message);
  return worker.fetch(new Request("https://api.test/discord/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": bytesToHex(new Uint8Array(signature)),
      "x-signature-timestamp": timestamp
    },
    body: rawBody
  }), env);
}

function createTestEnv(beforeRun?: (sql: string, sqlite: Database.Database) => void): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      discord_user_id TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE UNIQUE INDEX students_discord_user_id_unique_idx
    ON students(discord_user_id)
    WHERE discord_user_id IS NOT NULL;

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
      student_id TEXT NOT NULL,
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
    DB: d1(sqlite, beforeRun),
    DISCORD_PUBLIC_KEY: publicKeyHex
  } as unknown as Env;
}

function insertMeetingAndDelivery(env: Env, memberId: string, discordUserId: string) {
  const now = "2026-01-02T22:30:00.000Z";
  env.DB.prepare(`
    INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, created_at, updated_at)
    VALUES ('meeting-2026-01-02', '2026-01-02', 'Required Build', 1, '2026-01-02T20:00:00.000Z', '2026-01-02T22:00:00.000Z', ?, ?)
  `).bind(now, now).run();
  env.DB.prepare(`
    INSERT INTO notification_deliveries (
      id, notification_kind, meeting_date, student_id, recipient_email, status,
      provider_message_id, sent_at, created_at, updated_at
    ) VALUES (?, 'discord_bot_missing_members', '2026-01-02', ?, ?, 'sent', '444444444444444444', ?, ?, ?)
  `).bind(crypto.randomUUID(), memberId, discordUserId, now, now, now).run();
}

function countContests(env: Env) {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  return (db.sqlite.prepare("SELECT COUNT(*) AS count FROM attendance_contests").get() as { count: number }).count;
}

function insertStudent(
  env: Env,
  memberId: string,
  firstName: string,
  lastName: string,
  active = 1,
  discordUserId: string | null = null
) {
  return env.DB.prepare(
    "INSERT INTO students (student_id, first_name, last_name, discord_user_id, active) VALUES (?, ?, ?, ?, ?)"
  ).bind(memberId, firstName, lastName, discordUserId, active).run();
}

function discordIdFor(env: Env, memberId: string): string | null {
  const db = env.DB as unknown as ReturnType<typeof d1>;
  const row = db.sqlite.prepare("SELECT discord_user_id FROM students WHERE student_id = ?").get(memberId) as { discord_user_id: string | null };
  return row.discord_user_id;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function d1(sqlite: Database.Database, beforeRun?: (sql: string, sqlite: Database.Database) => void) {
  return {
    sqlite,
    prepare(sql: string) {
      return new TestStatement(sqlite, sql, beforeRun);
    }
  };
}

class TestStatement {
  private params: unknown[] = [];

  constructor(
    private readonly sqlite: Database.Database,
    private readonly sql: string,
    private readonly beforeRun?: (sql: string, sqlite: Database.Database) => void
  ) {}

  bind(...params: unknown[]) {
    const next = new TestStatement(this.sqlite, this.sql, this.beforeRun);
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
    this.beforeRun?.(this.sql, this.sqlite);
    return this.sqlite.prepare(this.sql).run(...this.params);
  }
}
