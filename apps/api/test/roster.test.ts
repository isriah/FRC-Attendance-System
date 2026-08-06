import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { listActiveRoster, normalizeRosterMembers, syncRoster, updateStudentEmail } from "../src/roster";

describe("roster sync", () => {
  it("normalizes rows, deactivates missing members, and exports active roster", async () => {
    const env = createRosterTestEnv();

    await syncRoster(env, [
      { memberId: " 100001 ", firstName: " Ada ", lastName: " Lovelace ", email: " ADA@Example.ORG " },
      { memberId: "100002", firstName: "Grace", lastName: "Hopper" }
    ]);

    const second = await syncRoster(env, [
      { memberId: "100002", firstName: "Grace", lastName: "Murray Hopper" }
    ]);

    expect(second).toMatchObject({ synced: 1, deactivatedMissingMembers: true, deactivatedMissingStudents: true });

    const roster = await listActiveRoster(env);
    expect(roster.members).toEqual([
      { memberId: "100002", firstName: "Grace", lastName: "Murray Hopper" }
    ]);

    const inactive = await env.DB.prepare("SELECT active FROM students WHERE student_id = ?").bind("100001").first<{ active: number }>();
    expect(inactive?.active).toBe(0);
  });

  it("stores, preserves, and clears member email associations", async () => {
    const env = createRosterTestEnv();

    await syncRoster(env, [
      { memberId: "100001", firstName: "Ada", lastName: "Lovelace", email: "ADA@Example.ORG" }
    ]);
    await expectStudentEmail(env, "100001", "ada@example.org");

    await syncRoster(env, [
      { memberId: "100001", firstName: "Ada", lastName: "Byron" }
    ]);
    await expectStudentEmail(env, "100001", "ada@example.org");

    await updateStudentEmail(env, "100001", "");
    await expectStudentEmail(env, "100001", null);
  });

  it("rejects duplicate member email associations", async () => {
    const env = createRosterTestEnv();

    await syncRoster(env, [
      { memberId: "100001", firstName: "Ada", lastName: "Lovelace", email: "ada@example.org" },
      { memberId: "100002", firstName: "Grace", lastName: "Hopper" }
    ]);

    await expect(updateStudentEmail(env, "100002", "ADA@example.org")).rejects.toMatchObject({
      message: "Email is already assigned to member 100001",
      status: 409
    });
    expect(() => normalizeRosterMembers([
      { memberId: "100001", firstName: "Ada", lastName: "Lovelace", email: "ada@example.org" },
      { memberId: "100002", firstName: "Grace", lastName: "Hopper", email: "ADA@example.org" }
    ])).toThrow("Duplicate roster email: ada@example.org");
  });

  it("rejects empty and duplicate roster inputs", () => {
    expect(() => normalizeRosterMembers([])).toThrow("Roster sync requires at least one member");
    expect(() => normalizeRosterMembers([
      { memberId: "100001", firstName: "Bench", lastName: "Student" },
      { memberId: " 100001 ", firstName: "Bench", lastName: "Student" }
    ])).toThrow("Duplicate roster memberId: 100001");
    expect(() => normalizeRosterMembers([
      { memberId: "100001", firstName: "Bench", lastName: "Student", email: "not-an-email" }
    ])).toThrow("email must be a valid email address");
  });
});

async function expectStudentEmail(env: Env, memberId: string, email: string | null) {
  const row = await env.DB.prepare("SELECT email FROM students WHERE student_id = ?").bind(memberId).first<{ email: string | null }>();
  expect(row?.email ?? null).toBe(email);
}

function createRosterTestEnv(): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      roster_hash TEXT,
      roster_synced_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX students_email_unique_idx
    ON students(email)
    WHERE email IS NOT NULL;

    CREATE TABLE sync_log (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      message TEXT
    );
  `);

  return { DB: d1(sqlite) } as unknown as Env;
}

function d1(sqlite: Database.Database) {
  return {
    prepare(sql: string) {
      return new TestStatement(sqlite, sql);
    },
    async batch(statements: TestStatement[]) {
      return statements.map((statement) => statement.run());
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
