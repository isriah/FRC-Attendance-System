import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildLegacySheetExport } from "../src/export";
import type { Env } from "../src/env";

describe("legacy export", () => {
  it("formats login and logout ranges for Google Sheets", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", "2026-01-02T22:00:00.000Z", "closed");

    const result = await buildLegacySheetExport(env);

    expect(result.ranges.AttendanceLogIn[0]?.[0]).toBe("100001");
    expect(result.ranges.AttendanceLogIn[0]?.[1]).toBe("1/2/2026");
    expect(result.ranges.AttendanceLogOut).toHaveLength(1);
  });

  it("exports mentor-ready meeting, absence, and roster attendance ranges without fake log rows", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertMeeting(env, "2026-01-02", "Build Night", 1);
    insertMeeting(env, "2026-01-03", "Optional Demo", 0);
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");

    const result = await buildLegacySheetExport(env);

    expect(result.ranges.AttendanceLogIn).toHaveLength(1);
    expect(result.ranges.MeetingSummary).toEqual([
      ["1/3/2026", "Optional Demo", "optional", "", "", "scheduled", 0, "", 0, "zero scans"],
      ["1/2/2026", "Build Night", "required", "", "", "scheduled", 1, 1, 1, ""]
    ]);
    expect(result.ranges.MeetingAbsences).toEqual([
      ["1/2/2026", "Build Night", "100002", "Drive", "Captain"]
    ]);
    expect(result.ranges.RosterAttendance).toEqual([
      ["100002", "Drive", "Captain", 1, 0, 1, 0, "", ""],
      ["100001", "Bench", "Student", 1, 1, 0, 1, "1/2/2026", "open check-in"]
    ]);
    expect(result.ranges.ScheduledMeetings).toEqual([
      ["1/2/2026", "Build Night", "required", "", "", 1],
      ["1/3/2026", "Optional Demo", "optional", "", "", 0]
    ]);
    expect(result.ranges.MemberAttendanceSummary).toEqual([
      ["100002", "Drive", "Captain", 1, 0, 1, 0, "", ""],
      ["100001", "Bench", "Student", 1, 1, 0, 1, "1/2/2026", "open check-in"]
    ]);
  });

  it("filters export ranges by date range", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertMeeting(env, "2026-01-02", "Week 1", 1);
    insertMeeting(env, "2026-01-09", "Week 2", 1);
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100001", "2026-01-09", "2026-01-09T20:00:00.000Z", null, "open");

    const result = await buildLegacySheetExport(env, { startDate: "2026-01-09", endDate: "2026-01-09" });

    expect(result.ranges.AttendanceLogIn).toEqual([["100001", "1/9/2026", "3:00 PM"]]);
    expect(result.ranges.MeetingSummary).toEqual([
      ["1/9/2026", "Week 2", "required", "", "", "scheduled", 1, 0, 1, ""]
    ]);
    expect(result.ranges.RosterAttendance).toEqual([
      ["100001", "Bench", "Student", 1, 1, 0, 1, "1/9/2026", "open check-in"]
    ]);
  });
});

function createTestEnv(): Env {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE students (
      student_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
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
  `);

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York"
  } as unknown as Env;
}

function insertStudent(env: Env, memberId: string, firstName: string, lastName: string, active = 1) {
  return env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES (?, ?, ?, ?)")
    .bind(memberId, firstName, lastName, active)
    .run();
}

function insertSession(
  env: Env,
  memberId: string,
  meetingDate: string,
  checkInAt: string,
  checkOutAt: string | null,
  status: "open" | "closed"
) {
  return env.DB.prepare(
    "INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, check_out_at, status, source_event_ids, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    `${memberId}-${meetingDate}-${checkInAt}`,
    memberId,
    meetingDate,
    checkInAt,
    checkOutAt,
    status,
    "[]",
    "2026-01-10T00:00:00.000Z"
  ).run();
}

function insertMeeting(env: Env, meetingDate: string, title: string, required = 1) {
  return env.DB.prepare(
    "INSERT INTO scheduled_meetings (id, meeting_date, title, required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    `meeting-${meetingDate}`,
    meetingDate,
    title,
    required,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  ).run();
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
