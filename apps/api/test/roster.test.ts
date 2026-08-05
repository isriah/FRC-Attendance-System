import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { listActiveRoster, normalizeRosterMembers, syncRoster } from "../src/roster";

describe("roster sync", () => {
  it("normalizes rows, deactivates missing members, and exports active roster", async () => {
    const env = createRosterTestEnv();

    await syncRoster(env, [
      { memberId: " 100001 ", firstName: " Ada ", lastName: " Lovelace " },
      { memberId: "100002", firstName: "Grace", lastName: "Hopper" }
    ]);

    const second = await syncRoster(env, [
      { memberId: "100002", firstName: "Grace", lastName: "Murray Hopper" }
    ]);

    expect(second).toMatchObject({ synced: 1, deactivatedMissingStudents: true });

    const roster = await listActiveRoster(env);
    expect(roster.members).toEqual([
      { memberId: "100002", firstName: "Grace", lastName: "Murray Hopper" }
    ]);

    const inactive = await env.DB.prepare("SELECT active FROM students WHERE student_id = ?").bind("100001").first<{ active: number }>();
    expect(inactive?.active).toBe(0);
  });

  it("rejects empty and duplicate roster inputs", () => {
    expect(() => normalizeRosterMembers([])).toThrow("Roster sync requires at least one member");
    expect(() => normalizeRosterMembers([
      { memberId: "100001", firstName: "Bench", lastName: "Student" },
      { memberId: " 100001 ", firstName: "Bench", lastName: "Student" }
    ])).toThrow("Duplicate roster memberId: 100001");
  });
});

function createRosterTestEnv(): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      roster_hash TEXT,
      roster_synced_at TEXT NOT NULL
    );

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
