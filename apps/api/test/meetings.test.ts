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
});

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
  `);

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York",
    GOOGLE_ALLOWED_EMAILS: "mentor@example.com",
    GOOGLE_ALLOWED_DOMAIN: "",
    GOOGLE_CLIENT_ID: "",
    DUPLICATE_WINDOW_SECONDS: "90"
  } as unknown as Env;
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
