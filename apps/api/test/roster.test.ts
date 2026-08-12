import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { deactivateMember, hardDeleteMember, listActiveRoster, listRosterMembers, normalizeRosterMembers, reactivateMember, syncRoster, updateStudentEmail } from "../src/roster";

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

  it("deactivates and reactivates members without deleting attendance history", async () => {
    const env = createRosterTestEnv();

    await syncRoster(env, [
      { memberId: "100001", firstName: "Ada", lastName: "Lovelace" },
      { memberId: "100002", firstName: "Grace", lastName: "Hopper" }
    ]);
    await seedMemberData(env, "100001");

    await expect(deactivateMember(env, "100001")).resolves.toMatchObject({ memberId: "100001", active: false });
    expect(await listRosterMembers(env, true)).toEqual([
      expect.objectContaining({ memberId: "100002", active: true })
    ]);
    expect(await listRosterMembers(env, false)).toEqual([
      expect.objectContaining({ memberId: "100001", active: false })
    ]);
    await expectRowCount(env, "scan_events", "student_id", "100001", 1);
    await expectRowCount(env, "attendance_sessions", "student_id", "100001", 1);

    await expect(reactivateMember(env, "100001")).resolves.toMatchObject({ memberId: "100001", active: true });
    expect(await listRosterMembers(env, true)).toEqual([
      expect.objectContaining({ memberId: "100002", active: true }),
      expect.objectContaining({ memberId: "100001", active: true })
    ]);
  });

  it("hard deletes member-owned roster, attendance, event, and fingerprint rows without deleting admin users", async () => {
    const env = createRosterTestEnv();

    await syncRoster(env, [
      { memberId: "100001", firstName: "Ada", lastName: "Lovelace", email: "ada@example.org" }
    ]);
    await seedMemberData(env, "100001");
    await env.DB.prepare("INSERT INTO admin_users (email, role, active) VALUES (?, 'admin', 1)").bind("ada@example.org").run();

    await expect(hardDeleteMember(env, "100001")).resolves.toMatchObject({
      memberId: "100001",
      firstName: "Ada",
      lastName: "Lovelace",
      hardDeleted: true
    });

    await expectRowCount(env, "students", "student_id", "100001", 0);
    await expectRowCount(env, "scan_events", "student_id", "100001", 0);
    await expectRowCount(env, "attendance_sessions", "student_id", "100001", 0);
    await expectRowCount(env, "manual_events", "student_id", "100001", 0);
    await expectRowCount(env, "fingerprint_enrollments", "student_id", "100001", 0);
    const admin = await env.DB.prepare("SELECT active FROM admin_users WHERE email = ?").bind("ada@example.org").first<{ active: number }>();
    expect(admin?.active).toBe(1);
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

async function expectRowCount(env: Env, table: string, column: string, value: string, expected: number) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).bind(value).first<{ count: number }>();
  expect(row?.count).toBe(expected);
}

async function seedMemberData(env: Env, memberId: string) {
  await env.DB.prepare(`
    INSERT INTO scan_events (id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status)
    VALUES ('scan-1', 'bench-01', 'local-1', ?, '2026-01-10T15:00:00.000Z', '2026-01-10T15:00:01.000Z', 'fingerprint', 'accepted')
  `).bind(memberId).run();
  await env.DB.prepare(`
    INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, status, source_event_ids, rebuilt_at)
    VALUES ('session-1', ?, '2026-01-10', '2026-01-10T15:00:00.000Z', 'open', '["scan-1"]', '2026-01-10T15:00:01.000Z')
  `).bind(memberId).run();
  await env.DB.prepare(`
    INSERT INTO manual_events (id, student_id, occurred_at, action, reason, admin_email)
    VALUES ('manual-1', ?, '2026-01-10T16:00:00.000Z', 'check_out', 'mentor correction', 'mentor@example.org')
  `).bind(memberId).run();
  await env.DB.prepare(`
    INSERT INTO fingerprint_enrollments (student_id, kiosk_id, template_slot, finger_label, enrolled_at)
    VALUES (?, 'bench-01', 1, 'right-index', '2026-01-10T14:00:00.000Z')
  `).bind(memberId).run();
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

    CREATE TABLE admin_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'mentor',
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT
    );

    CREATE TABLE fingerprint_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      kiosk_id TEXT NOT NULL,
      template_slot INTEGER NOT NULL,
      finger_label TEXT,
      enrolled_at TEXT NOT NULL,
      deleted_at TEXT
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
      admin_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
