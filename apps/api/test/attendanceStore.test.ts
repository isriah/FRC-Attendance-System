import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { syncKioskEvents } from "../src/attendanceStore";
import type { Env } from "../src/env";

describe("kiosk sync acknowledgements", () => {
  it("returns welcome and goodbye acknowledgements for remote kiosk scans", async () => {
    const env = createTestEnv();

    const first = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-1",
      studentId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(first.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-1",
      studentId: "100001",
      status: "accepted",
      displayName: "Bench Student",
      action: "check_in",
      kioskMessage: "Welcome, Bench Student",
      kioskDetail: "Checked in at 3:00 PM - Attendance 100% (1/1)",
      message: "Welcome, Bench Student",
      attendanceSummary: "Attendance 100% (1/1)"
    });

    const second = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-2",
      studentId: "100001",
      occurredAt: "2026-01-02T22:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(second.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-2",
      status: "accepted",
      action: "check_out",
      kioskMessage: "Goodbye, Bench Student",
      kioskDetail: "Checked out at 5:00 PM - Attendance 100% (1/1)",
      message: "Goodbye, Bench Student",
      attendanceSummary: "Attendance 100% (1/1)"
    });
  });

  it("returns duplicate acknowledgements inside the duplicate window", async () => {
    const env = createTestEnv();

    await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-1",
      studentId: "100001",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    const duplicate = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-duplicate",
      studentId: "100001",
      occurredAt: "2026-01-02T20:00:30.000Z",
      source: "fingerprint"
    }]);

    expect(duplicate.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-duplicate",
      studentId: "100001",
      status: "duplicate",
      displayName: "Bench Student",
      kioskMessage: "Already recorded",
      kioskDetail: "Bench Student - This scan was just counted. Please wait before scanning again.",
      message: "Bench Student was already recorded."
    });
  });

  it("returns roster issue details for inactive member scans", async () => {
    const env = createTestEnv();
    await env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES (?, ?, ?, 0)")
      .bind("100002", "Inactive", "Member")
      .run();

    const rejected = await syncKioskEvents(env, "bench-01", [{
      localEventId: "scan-inactive",
      studentId: "100002",
      occurredAt: "2026-01-02T20:00:00.000Z",
      source: "fingerprint"
    }]);

    expect(rejected.acknowledgements?.[0]).toMatchObject({
      localEventId: "scan-inactive",
      studentId: "100002",
      status: "rejected",
      displayName: "Inactive Member",
      kioskMessage: "Roster issue",
      kioskDetail: "Inactive Member - Member is not active in the roster.",
      message: "Member is not active in the roster."
    });
  });
});

function createTestEnv(): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      roster_synced_at TEXT,
      roster_hash TEXT
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
      rejection_reason TEXT,
      UNIQUE(kiosk_id, local_event_id)
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
  `);
  sqlite.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES (?, ?, ?, 1)").run("100001", "Bench", "Student");

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York",
    DUPLICATE_WINDOW_SECONDS: "90"
  } as unknown as Env;
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
