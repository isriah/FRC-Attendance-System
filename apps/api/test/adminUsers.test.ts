import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

describe("admin user authorization", () => {
  it("allows an active admin_users email even when it is not in the env allowlist", async () => {
    const env = createTestEnv({ allowedEmails: "" });
    await env.DB.prepare("INSERT INTO admin_users (email, role, active) VALUES (?, ?, 1)")
      .bind("mentor@example.org", "admin")
      .run();

    const response = await request(env, "GET", "/admin/admin-users", undefined, "mentor@example.org");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      adminUsers: [{
        email: "mentor@example.org",
        role: "admin",
        active: true
      }]
    });
  });

  it("keeps disabled admin_users blocked even when the email is env allowlisted", async () => {
    const env = createTestEnv({ allowedEmails: "mentor@example.org" });
    await env.DB.prepare("INSERT INTO admin_users (email, role, active) VALUES (?, ?, 0)")
      .bind("mentor@example.org", "mentor")
      .run();

    const response = await request(env, "GET", "/admin/admin-users", undefined, "mentor@example.org");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin user is disabled" });
  });

  it("lets an env bootstrap admin add a database-backed OAuth admin", async () => {
    const env = createTestEnv({ allowedEmails: "owner@example.org" });

    const created = await request(env, "PUT", "/admin/admin-users/MENTOR%40Example.ORG", {
      role: "admin",
      active: true
    }, "owner@example.org");

    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      email: "mentor@example.org",
      role: "admin",
      active: true
    });

    const databaseAdmin = await request(env, "GET", "/admin/admin-users", undefined, "mentor@example.org");
    expect(databaseAdmin.status).toBe(200);
  });

  it("rejects invalid admin user roles", async () => {
    const env = createTestEnv({ allowedEmails: "owner@example.org" });

    const response = await request(env, "PUT", "/admin/admin-users/mentor%40example.org", {
      role: "superuser",
      active: true
    }, "owner@example.org");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Admin role must be mentor or admin" });
  });
});

function createTestEnv({ allowedEmails }: { allowedEmails: string }): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE admin_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'mentor',
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT
    );
  `);

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York",
    GOOGLE_ALLOWED_EMAILS: allowedEmails,
    GOOGLE_ALLOWED_DOMAIN: "",
    GOOGLE_CLIENT_ID: "",
    DUPLICATE_WINDOW_SECONDS: "90"
  } as unknown as Env;
}

function request(env: Env, method: string, path: string, body: unknown, adminEmail: string) {
  return worker.fetch(new Request(`https://api.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-email": adminEmail
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
