import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildAttendanceSessionReport, buildMemberAttendanceReport, buildPresenceReport } from "../src/reports";
import type { Env } from "../src/env";

describe("report builders", () => {
  it("builds daily presence rows and counts for active members", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertStudent(env, "100003", "Pit", "Lead");
    insertStudent(env, "999999", "Inactive", "Member", 0);
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100002", "2026-01-02", "2026-01-02T19:45:00.000Z", "2026-01-02T22:00:00.000Z", "closed");
    insertSession(env, "999999", "2026-01-02", "2026-01-02T19:30:00.000Z", null, "open");
    insertSession(env, "100003", "2026-01-03", "2026-01-03T20:00:00.000Z", null, "open");

    const report = await buildPresenceReport(env, "2026-01-02");

    expect(report.counts).toEqual({ signedIn: 1, signedOut: 1, notSeen: 1 });
    expect(report.rows).toEqual([
      {
        studentId: "100002",
        firstName: "Drive",
        lastName: "Captain",
        status: "signed_out",
        checkInAt: "2026-01-02T19:45:00.000Z",
        checkOutAt: "2026-01-02T22:00:00.000Z"
      },
      {
        studentId: "100003",
        firstName: "Pit",
        lastName: "Lead",
        status: "not_seen",
        checkInAt: undefined,
        checkOutAt: undefined
      },
      {
        studentId: "100001",
        firstName: "Bench",
        lastName: "Student",
        status: "signed_in",
        checkInAt: "2026-01-02T20:00:00.000Z",
        checkOutAt: undefined
      }
    ]);
  });

  it("deduplicates member presence across all meeting dates", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", "2026-01-02T22:00:00.000Z", "closed");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T23:00:00.000Z", null, "open");
    insertSession(env, "100002", "2026-01-09", "2026-01-09T20:00:00.000Z", null, "open");

    const report = await buildMemberAttendanceReport(env, "100001");

    expect(report).toMatchObject({
      studentId: "100001",
      firstName: "Bench",
      lastName: "Student",
      totalMeetings: 2,
      presentMeetings: 1,
      missedMeetings: 1,
      attendanceRate: 0.5,
      presentDates: ["2026-01-02"],
      absentDates: ["2026-01-09"],
      openSessionDates: ["2026-01-02"]
    });
  });

  it("returns a null attendance rate before any meetings exist", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");

    const report = await buildMemberAttendanceReport(env, "100001");

    expect(report.totalMeetings).toBe(0);
    expect(report.attendanceRate).toBeNull();
    expect(report.presentDates).toEqual([]);
    expect(report.absentDates).toEqual([]);
  });

  it("counts required scheduled meetings with no scans as missed", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertMeeting(env, "2026-01-02");
    insertMeeting(env, "2026-01-09");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");

    const report = await buildMemberAttendanceReport(env, "100001");

    expect(report).toMatchObject({
      totalMeetings: 2,
      presentMeetings: 1,
      missedMeetings: 1,
      attendanceRate: 0.5,
      presentDates: ["2026-01-02"],
      absentDates: ["2026-01-09"],
      openSessionDates: ["2026-01-02"]
    });
  });

  it("excludes optional scheduled meetings from member attendance totals", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertMeeting(env, "2026-01-02");
    insertMeeting(env, "2026-01-03", 0);
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100001", "2026-01-03", "2026-01-03T20:00:00.000Z", null, "open");

    const report = await buildMemberAttendanceReport(env, "100001");

    expect(report).toMatchObject({
      totalMeetings: 1,
      presentMeetings: 1,
      missedMeetings: 0,
      attendanceRate: 1,
      presentDates: ["2026-01-02"],
      absentDates: [],
      openSessionDates: ["2026-01-02"]
    });
  });

  it("includes scheduled meetings with no scans in the session report", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertMeeting(env, "2026-01-02", 1, "Required Shop");
    insertMeeting(env, "2026-01-03", 0, "Optional Outreach");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");

    const rows = await buildAttendanceSessionReport(env);

    expect(rows).toEqual([
      {
        meeting_date: "2026-01-03",
        meeting_title: "Optional Outreach",
        required: 0,
        has_attendance: 0,
        student_id: null,
        check_in_at: null,
        check_out_at: null,
        status: "scheduled"
      },
      {
        meeting_date: "2026-01-02",
        meeting_title: "Required Shop",
        required: 1,
        has_attendance: 1,
        student_id: "100001",
        check_in_at: "2026-01-02T20:00:00.000Z",
        check_out_at: null,
        status: "open"
      }
    ]);
  });

  it("marks missing members as not found", async () => {
    const env = createTestEnv();

    await expect(buildMemberAttendanceReport(env, "missing")).rejects.toMatchObject({
      message: "Member not found",
      status: 404
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

function insertStudent(env: Env, studentId: string, firstName: string, lastName: string, active = 1) {
  return env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, active) VALUES (?, ?, ?, ?)")
    .bind(studentId, firstName, lastName, active)
    .run();
}

function insertSession(
  env: Env,
  studentId: string,
  meetingDate: string,
  checkInAt: string,
  checkOutAt: string | null,
  status: "open" | "closed"
) {
  return env.DB.prepare(
    "INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, check_out_at, status, source_event_ids, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    `${studentId}-${meetingDate}-${checkInAt}`,
    studentId,
    meetingDate,
    checkInAt,
    checkOutAt,
    status,
    "[]",
    "2026-01-10T00:00:00.000Z"
  ).run();
}

function insertMeeting(env: Env, meetingDate: string, required = 1, title = `Meeting ${meetingDate}`) {
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
