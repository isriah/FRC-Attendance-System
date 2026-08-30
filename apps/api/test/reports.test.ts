import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  buildAttendanceSessionReport,
  buildMeetingAbsenceReport,
  buildMeetingSummaryReport,
  buildMemberAttendanceReport,
  buildPresenceReport,
  buildRosterAttendanceSummary,
  reportDateRangeFromSearchParams
} from "../src/reports";
import { buildLegacySheetExport } from "../src/export";
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
        memberId: "100002",
        firstName: "Drive",
        lastName: "Captain",
        status: "signed_out",
        checkInAt: "2026-01-02T19:45:00.000Z",
        checkOutAt: "2026-01-02T22:00:00.000Z"
      },
      {
        memberId: "100003",
        firstName: "Pit",
        lastName: "Lead",
        status: "not_seen",
        checkInAt: undefined,
        checkOutAt: undefined
      },
      {
        memberId: "100001",
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

    const report = await buildMemberAttendanceReport(env, "100001", { includeUnscheduled: true });

    expect(report).toMatchObject({
      memberId: "100001",
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
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", "2026-01-02T22:00:00.000Z", "closed");

    const report = await buildMemberAttendanceReport(env, "100001");

    expect(report).toMatchObject({
      totalMeetings: 2,
      presentMeetings: 1,
      missedMeetings: 1,
      attendanceRate: 0.5,
      presentDates: ["2026-01-02"],
      absentDates: ["2026-01-09"],
      openSessionDates: []
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
      presentMeetings: 0,
      missedMeetings: 1,
      attendanceRate: 0,
      presentDates: [],
      absentDates: ["2026-01-02"],
      openSessionDates: ["2026-01-02"]
    });
  });

  it("excludes future required meetings from member and roster attendance counts", async () => {
    const env = createTestEnv();
    const now = new Date("2026-01-02T22:30:00.000Z");
    insertStudent(env, "100001", "Bench", "Member");
    insertStudent(env, "100002", "Drive", "Captain");
    insertMeeting(
      env,
      "2026-01-02",
      1,
      "Completed Build",
      "2026-01-02T20:00:00.000Z",
      "2026-01-02T22:00:00.000Z"
    );
    insertMeeting(
      env,
      "2026-01-09",
      1,
      "Future Build",
      "2026-01-09T20:00:00.000Z",
      "2026-01-09T22:00:00.000Z"
    );
    insertMeeting(env, "2026-01-10", 1, "Future Date-Only Build");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:05:00.000Z", "2026-01-02T22:10:00.000Z", "closed");

    const memberReport = await buildMemberAttendanceReport(env, "100001", {}, now);
    const rosterSummary = await buildRosterAttendanceSummary(env, {}, now);

    expect(memberReport).toMatchObject({
      totalMeetings: 1,
      presentMeetings: 1,
      missedMeetings: 0,
      attendanceRate: 1,
      presentDates: ["2026-01-02"],
      absentDates: []
    });
    expect(rosterSummary).toEqual([
      {
        memberId: "100002",
        firstName: "Drive",
        lastName: "Captain",
        requiredMeetings: 1,
        presentMeetings: 0,
        missedMeetings: 1,
        attendanceRate: 0,
        lastSeenAt: undefined,
        openSessionDates: [],
        openSessionWarning: false,
        attendanceRequiredFromDate: null
      },
      {
        memberId: "100001",
        firstName: "Bench",
        lastName: "Member",
        requiredMeetings: 1,
        presentMeetings: 1,
        missedMeetings: 0,
        attendanceRate: 1,
        lastSeenAt: "2026-01-02T20:05:00.000Z",
        openSessionDates: [],
        openSessionWarning: false,
        attendanceRequiredFromDate: null
      }
    ]);
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
        member_id: null,
        check_in_at: null,
        check_out_at: null,
        status: "scheduled"
      },
      {
        meeting_date: "2026-01-02",
        meeting_title: "Required Shop",
        required: 1,
        has_attendance: 1,
        member_id: "100001",
        check_in_at: "2026-01-02T20:00:00.000Z",
        check_out_at: null,
        status: "open"
      }
    ]);
  });

  it("hides future scheduled meetings from default meeting reports", async () => {
    const env = createTestEnv();
    const now = new Date("2026-01-02T22:30:00.000Z");
    insertStudent(env, "100001", "Bench", "Member");
    insertStudent(env, "100002", "Drive", "Captain");
    insertMeeting(
      env,
      "2026-01-02",
      1,
      "Completed Build",
      "2026-01-02T20:00:00.000Z",
      "2026-01-02T22:00:00.000Z"
    );
    insertMeeting(
      env,
      "2026-01-03",
      0,
      "Future Optional",
      "2026-01-03T20:00:00.000Z",
      "2026-01-03T22:00:00.000Z"
    );
    insertMeeting(env, "2026-01-09", 1, "Future Date-Only Required");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:05:00.000Z", "2026-01-02T22:10:00.000Z", "closed");

    const meetingSummary = await buildMeetingSummaryReport(env, {}, 500, now);
    const sessionRows = await buildAttendanceSessionReport(env, {}, 500, now);

    expect(meetingSummary.map((meeting) => meeting.meetingDate)).toEqual(["2026-01-02"]);
    expect(meetingSummary[0]).toMatchObject({
      meetingDate: "2026-01-02",
      required: true,
      presentCount: 1,
      activePresentCount: 1,
      absentCount: 1
    });
    expect(sessionRows.map((row) => row.meeting_date)).toEqual(["2026-01-02"]);
  });

  it("filters session report rows by date range before adding zero-scan scheduled meetings", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertMeeting(env, "2026-01-02", 1, "Before Range");
    insertMeeting(env, "2026-01-09", 1, "In Range Required");
    insertMeeting(env, "2026-01-16", 0, "In Range Optional");
    insertMeeting(env, "2026-01-23", 1, "After Range");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100001", "2026-01-09", "2026-01-09T20:00:00.000Z", "2026-01-09T22:00:00.000Z", "closed");
    insertSession(env, "100001", "2026-01-23", "2026-01-23T20:00:00.000Z", null, "open");

    const rows = await buildAttendanceSessionReport(env, { startDate: "2026-01-09", endDate: "2026-01-16" });

    expect(rows).toEqual([
      {
        meeting_date: "2026-01-16",
        meeting_title: "In Range Optional",
        required: 0,
        has_attendance: 0,
        member_id: null,
        check_in_at: null,
        check_out_at: null,
        status: "scheduled"
      },
      {
        meeting_date: "2026-01-09",
        meeting_title: "In Range Required",
        required: 1,
        has_attendance: 1,
        member_id: "100001",
        check_in_at: "2026-01-09T20:00:00.000Z",
        check_out_at: "2026-01-09T22:00:00.000Z",
        status: "closed"
      }
    ]);
  });

  it("summarizes scheduled meetings with required absences, optional meetings, open check-ins, and zero scans", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertStudent(env, "100003", "Pit", "Lead");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertMeeting(env, "2026-01-03", 0, "Optional Demo");
    insertMeeting(env, "2026-01-09", 1, "Required Strategy");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100002", "2026-01-02", "2026-01-02T20:05:00.000Z", "2026-01-02T22:00:00.000Z", "closed");
    insertSession(env, "100003", "2026-01-03", "2026-01-03T20:00:00.000Z", null, "open");

    const rows = await buildMeetingSummaryReport(env, { startDate: "2026-01-02", endDate: "2026-01-09" });

    expect(rows).toEqual([
      {
        meetingDate: "2026-01-09",
        title: "Required Strategy",
        required: true,
        startsAt: undefined,
        endsAt: undefined,
        scheduled: true,
        hasAttendance: false,
        zeroScan: true,
        presentCount: 0,
        activePresentCount: 0,
        absentCount: 3,
        openCheckIns: 0
      },
      {
        meetingDate: "2026-01-03",
        title: "Optional Demo",
        required: false,
        startsAt: undefined,
        endsAt: undefined,
        scheduled: true,
        hasAttendance: true,
        zeroScan: false,
        presentCount: 0,
        activePresentCount: 0,
        absentCount: 0,
        openCheckIns: 1
      },
      {
        meetingDate: "2026-01-02",
        title: "Required Build",
        required: true,
        startsAt: undefined,
        endsAt: undefined,
        scheduled: true,
        hasAttendance: true,
        zeroScan: false,
        presentCount: 1,
        activePresentCount: 1,
        absentCount: 2,
        openCheckIns: 1
      }
    ]);
  });

  it("computes required meeting absences from active roster members when inactive members have sessions", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertStudent(env, "999999", "Former", "Member", 0);
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "999999", "2026-01-02", "2026-01-02T20:10:00.000Z", null, "open");

    const rows = await buildMeetingSummaryReport(env);

    expect(rows[0]).toMatchObject({
      meetingDate: "2026-01-02",
      required: true,
      presentCount: 0,
      activePresentCount: 0,
      absentCount: 2,
      openCheckIns: 2
    });
  });

  it("hides unscheduled attendance from meeting reports by default and includes it when requested", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100001", "2026-01-09", "2026-01-09T20:00:00.000Z", null, "open");

    const defaultSummary = await buildMeetingSummaryReport(env);
    const defaultSessions = await buildAttendanceSessionReport(env);
    const visibleSummary = await buildMeetingSummaryReport(env, { includeUnscheduled: true });
    const visibleSessions = await buildAttendanceSessionReport(env, { includeUnscheduled: true });

    expect(defaultSummary.map((row) => row.meetingDate)).toEqual(["2026-01-02"]);
    expect(defaultSessions.map((row) => row.meeting_date)).toEqual(["2026-01-02"]);
    expect(visibleSummary.map((row) => row.meetingDate)).toEqual(["2026-01-09", "2026-01-02"]);
    expect(visibleSummary[0]).toMatchObject({
      meetingDate: "2026-01-09",
      title: null,
      scheduled: false,
      hasAttendance: true
    });
    expect(visibleSessions.map((row) => row.meeting_date)).toEqual(["2026-01-09", "2026-01-02"]);
  });

  it("treats unscheduled attendance dates as required only when explicitly included and no scheduled meetings exist", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertStudent(env, "999999", "Former", "Member", 0);
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "999999", "2026-01-02", "2026-01-02T20:10:00.000Z", null, "open");
    insertSession(env, "100002", "2026-01-09", "2026-01-09T20:00:00.000Z", "2026-01-09T22:00:00.000Z", "closed");

    const defaultRows = await buildMeetingSummaryReport(env, { startDate: "2026-01-02", endDate: "2026-01-02" });
    const rows = await buildMeetingSummaryReport(env, { startDate: "2026-01-02", endDate: "2026-01-02", includeUnscheduled: true });

    expect(defaultRows).toEqual([]);
    expect(rows).toEqual([
      {
        meetingDate: "2026-01-02",
        title: null,
        required: true,
        startsAt: undefined,
        endsAt: undefined,
        scheduled: false,
        hasAttendance: true,
        zeroScan: false,
        presentCount: 0,
        activePresentCount: 0,
        absentCount: 2,
        openCheckIns: 2
      }
    ]);
  });

  it("parses the unscheduled report toggle from search params", () => {
    expect(reportDateRangeFromSearchParams(new URLSearchParams("includeUnscheduled=true"))).toMatchObject({
      includeUnscheduled: true
    });
    expect(reportDateRangeFromSearchParams(new URLSearchParams())).toMatchObject({
      includeUnscheduled: false
    });
  });

  it("returns absent active roster rows for a required meeting", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertStudent(env, "100003", "Inactive", "Member", 0);
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", "2026-01-02T22:00:00.000Z", "closed");

    const report = await buildMeetingAbsenceReport(env, "2026-01-02");

    expect(report).toEqual({
      meetingDate: "2026-01-02",
      title: "Required Build",
      required: true,
      startsAt: undefined,
      endsAt: undefined,
      absentCount: 1,
      notRequiredCount: 0,
      rows: [{ memberId: "100002", firstName: "Drive", lastName: "Captain" }],
      notRequiredRows: []
    });
  });

  it("includes meeting times and sorts absence rows by roster display order", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Zoe", "Zephyr");
    insertStudent(env, "100002", "Alex", "Anderson");
    insertStudent(env, "100003", "Maya", "Anderson");
    insertStudent(env, "100004", "Bench", "Student");
    insertMeeting(
      env,
      "2026-01-02",
      1,
      "Timed Required Build",
      "2026-01-02T20:00:00.000Z",
      "2026-01-02T23:00:00.000Z"
    );
    insertSession(env, "100004", "2026-01-02", "2026-01-02T20:05:00.000Z", "2026-01-02T22:00:00.000Z", "closed");

    const report = await buildMeetingAbsenceReport(env, "2026-01-02");

    expect(report).toEqual({
      meetingDate: "2026-01-02",
      title: "Timed Required Build",
      required: true,
      startsAt: "2026-01-02T20:00:00.000Z",
      endsAt: "2026-01-02T23:00:00.000Z",
      absentCount: 3,
      notRequiredCount: 0,
      rows: [
        { memberId: "100002", firstName: "Alex", lastName: "Anderson" },
        { memberId: "100003", firstName: "Maya", lastName: "Anderson" },
        { memberId: "100001", firstName: "Zoe", lastName: "Zephyr" }
      ],
      notRequiredRows: []
    });
  });

  it("does not mark absences for optional meetings", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertMeeting(env, "2026-01-03", 0, "Optional Demo");

    const report = await buildMeetingAbsenceReport(env, "2026-01-03");

    expect(report.required).toBe(false);
    expect(report.absentCount).toBe(0);
    expect(report.rows).toEqual([]);
  });

  it("does not mark absences for required meetings that have not ended yet", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertMeeting(
      env,
      "2026-01-02",
      1,
      "In Progress Build",
      "2026-01-02T20:00:00.000Z",
      "2026-01-02T23:00:00.000Z"
    );

    const report = await buildMeetingAbsenceReport(env, "2026-01-02", new Date("2026-01-02T22:30:00.000Z"));

    expect(report).toMatchObject({
      meetingDate: "2026-01-02",
      title: "In Progress Build",
      required: true,
      absentCount: 0,
      rows: []
    });
  });

  it("excludes optional scheduled meetings from roster attendance percentages", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Member");
    insertMeeting(env, "2026-01-03", 1, "Required Build");
    insertMeeting(env, "2026-01-04", 0, "Optional Demo");
    insertSession(env, "100001", "2026-01-04", "2026-01-04T20:00:00.000Z", "2026-01-04T22:00:00.000Z", "closed");

    const rosterSummary = await buildRosterAttendanceSummary(env);

    expect(rosterSummary).toEqual([
      {
        memberId: "100001",
        firstName: "Bench",
        lastName: "Member",
        requiredMeetings: 1,
        presentMeetings: 0,
        missedMeetings: 1,
        attendanceRate: 0,
        lastSeenAt: "2026-01-04T20:00:00.000Z",
        openSessionDates: [],
        openSessionWarning: false,
        attendanceRequiredFromDate: null
      }
    ]);
  });

  it("treats required meetings before a member's attendance start date as not required", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Present", "Member", 1, "2026-01-01");
    insertStudent(env, "100002", "New", "Member", 1, "2026-01-09");
    insertMeeting(env, "2026-01-02", 1, "Before Join");
    insertMeeting(env, "2026-01-09", 1, "Join Day");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", "2026-01-02T22:00:00.000Z", "closed");
    insertSession(env, "100001", "2026-01-09", "2026-01-09T20:00:00.000Z", "2026-01-09T22:00:00.000Z", "closed");

    const absence = await buildMeetingAbsenceReport(env, "2026-01-02");
    const newMemberReport = await buildMemberAttendanceReport(env, "100002");
    const rosterSummary = await buildRosterAttendanceSummary(env);
    const meetingSummary = await buildMeetingSummaryReport(env);

    expect(absence).toMatchObject({
      absentCount: 0,
      notRequiredCount: 1,
      rows: [],
      notRequiredRows: [{
        memberId: "100002",
        attendanceRequiredFromDate: "2026-01-09",
        reason: "before_attendance_required_from_date"
      }]
    });
    expect(newMemberReport).toMatchObject({
      totalMeetings: 1,
      presentMeetings: 0,
      missedMeetings: 1,
      absentDates: ["2026-01-09"],
      attendanceRequiredFromDate: "2026-01-09"
    });
    expect(rosterSummary.find((row) => row.memberId === "100002")).toMatchObject({
      requiredMeetings: 1,
      missedMeetings: 1,
      attendanceRequiredFromDate: "2026-01-09"
    });
    expect(meetingSummary.find((row) => row.meetingDate === "2026-01-02")).toMatchObject({
      presentCount: 1,
      activePresentCount: 1,
      absentCount: 0
    });
    expect(meetingSummary.find((row) => row.meetingDate === "2026-01-09")).toMatchObject({
      absentCount: 1
    });
  });

  it("keeps team attendance and absence reports unchanged while calculating class attendance around an excuse", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Excused", "Member");
    insertStudent(env, "100002", "Present", "Member");
    insertMeeting(env, "2026-01-02", 1, "Required Build");
    insertMeeting(env, "2026-01-09", 1, "Required Strategy");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", "2026-01-02T22:00:00.000Z", "closed");
    insertSession(env, "100002", "2026-01-02", "2026-01-02T20:00:00.000Z", "2026-01-02T22:00:00.000Z", "closed");
    await env.DB.prepare("INSERT INTO attendance_excuses (id, student_id, meeting_date, reason, created_by_email, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("excuse-1", "100001", "2026-01-09", "Family commitment", "mentor@example.org", "2026-01-01T00:00:00.000Z").run();

    const member = await buildMemberAttendanceReport(env, "100001");
    const absence = await buildMeetingAbsenceReport(env, "2026-01-09");
    const roster = await buildRosterAttendanceSummary(env);

    expect(member).toMatchObject({ totalMeetings: 2, presentMeetings: 1, missedMeetings: 1, attendanceRate: 0.5, excusedMeetings: 1, classRequiredMeetings: 1, classAttendanceRate: 1 });
    expect(member.scheduledMeetings.find((meeting) => meeting.meetingDate === "2026-01-09")).toMatchObject({ excused: true, excuseReason: "Family commitment", excusedBy: "mentor@example.org" });
    expect(absence).toMatchObject({ absentCount: 2, excusedCount: 1 });
    expect(absence.rows.find((row) => row.memberId === "100001")).toMatchObject({ excused: true, excuseReason: "Family commitment" });
    expect(roster.find((row) => row.memberId === "100001")).toMatchObject({ attendanceRate: 0.5, classAttendanceRate: 1 });
  });

  it("filters member attendance and roster summary by report date range", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertMeeting(env, "2026-01-02", 1, "Week 1");
    insertMeeting(env, "2026-01-09", 1, "Week 2");
    insertMeeting(env, "2026-01-16", 1, "Week 3");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100001", "2026-01-09", "2026-01-09T20:00:00.000Z", "2026-01-09T22:00:00.000Z", "closed");
    insertSession(env, "100002", "2026-01-16", "2026-01-16T20:00:00.000Z", "2026-01-16T22:00:00.000Z", "closed");

    const memberReport = await buildMemberAttendanceReport(env, "100001", { startDate: "2026-01-09", endDate: "2026-01-16" });
    const rosterSummary = await buildRosterAttendanceSummary(env, { startDate: "2026-01-09", endDate: "2026-01-16" });

    expect(memberReport).toMatchObject({
      startDate: "2026-01-09",
      endDate: "2026-01-16",
      totalMeetings: 2,
      presentMeetings: 1,
      missedMeetings: 1,
      attendanceRate: 0.5,
      lastSeenAt: "2026-01-09T20:00:00.000Z",
      presentDates: ["2026-01-09"],
      absentDates: ["2026-01-16"],
      openSessionDates: []
    });
    expect(rosterSummary).toEqual([
      {
        memberId: "100002",
        firstName: "Drive",
        lastName: "Captain",
        requiredMeetings: 2,
        presentMeetings: 1,
        missedMeetings: 1,
        attendanceRate: 0.5,
        lastSeenAt: "2026-01-16T20:00:00.000Z",
        openSessionDates: [],
        openSessionWarning: false,
        attendanceRequiredFromDate: null
      },
      {
        memberId: "100001",
        firstName: "Bench",
        lastName: "Student",
        requiredMeetings: 2,
        presentMeetings: 1,
        missedMeetings: 1,
        attendanceRate: 0.5,
        lastSeenAt: "2026-01-09T20:00:00.000Z",
        openSessionDates: [],
        openSessionWarning: false,
        attendanceRequiredFromDate: null
      }
    ]);
  });

  it("validates report date ranges", () => {
    expect(reportDateRangeFromSearchParams(new URLSearchParams("startDate=2026-01-02&endDate=2026-01-09"))).toEqual({
      startDate: "2026-01-02",
      endDate: "2026-01-09",
      includeUnscheduled: false
    });
    expect(() => reportDateRangeFromSearchParams(new URLSearchParams("startDate=2026-01-09&endDate=2026-01-02"))).toThrow("startDate must be on or before endDate");
  });

  it("builds legacy export-oriented report ranges with formatted values and date filtering", async () => {
    const env = createTestEnv();
    insertStudent(env, "100001", "Bench", "Student");
    insertStudent(env, "100002", "Drive", "Captain");
    insertMeeting(env, "2026-01-02", 1, "Before Range");
    insertMeeting(
      env,
      "2026-01-09",
      1,
      "Required Build",
      "2026-01-09T20:00:00.000Z",
      "2026-01-09T23:00:00.000Z"
    );
    insertMeeting(env, "2026-01-16", 0, "Optional Demo");
    insertSession(env, "100001", "2026-01-02", "2026-01-02T20:00:00.000Z", null, "open");
    insertSession(env, "100001", "2026-01-09", "2026-01-09T20:05:00.000Z", "2026-01-09T22:15:00.000Z", "closed");
    insertSession(env, "100002", "2026-01-16", "2026-01-16T20:10:00.000Z", "2026-01-16T22:00:00.000Z", "closed");

    const exportData = await buildLegacySheetExport(env, { startDate: "2026-01-09", endDate: "2026-01-16" });

    expect(exportData.generatedAt).toEqual(expect.any(String));
    expect(exportData.ranges).toEqual({
      MeetingSummary: [
        ["1/16/2026", "Optional Demo", "optional", "", "", "scheduled", 1, "", 0, ""],
        ["1/9/2026", "Required Build", "required", "3:00 PM", "6:00 PM", "scheduled", 1, 1, 0, ""]
      ],
      MeetingAbsences: [
        ["1/9/2026", "Required Build", "100002", "Drive", "Captain"]
      ],
      RosterAttendance: [
        ["100002", "Drive", "Captain", 1, 0, 1, 0, "1/16/2026", ""],
        ["100001", "Bench", "Student", 1, 1, 0, 1, "1/9/2026", ""]
      ],
      AttendanceLogIn: [
        ["100001", "1/9/2026", "3:05 PM"],
        ["100002", "1/16/2026", "3:10 PM"]
      ],
      AttendanceLogOut: [
        ["100001", "1/9/2026", "5:15 PM"],
        ["100002", "1/16/2026", "5:00 PM"]
      ],
      ScheduledMeetings: [
        ["1/9/2026", "Required Build", "required", "3:00 PM", "6:00 PM", 1],
        ["1/16/2026", "Optional Demo", "optional", "", "", 1]
      ],
      MemberAttendanceSummary: [
        ["100002", "Drive", "Captain", 1, 0, 1, 0, "1/16/2026", ""],
        ["100001", "Bench", "Student", 1, 1, 0, 1, "1/9/2026", ""]
      ]
    });
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
      , attendance_required_from_date TEXT
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

    CREATE TABLE attendance_excuses (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      reason TEXT,
      created_by_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      removed_by_email TEXT,
      removed_at TEXT
    );
  `);

  return {
    DB: d1(sqlite),
    TIME_ZONE: "America/New_York"
  } as unknown as Env;
}

function insertStudent(env: Env, memberId: string, firstName: string, lastName: string, active = 1, attendanceRequiredFromDate: string | null = null) {
  return env.DB.prepare("INSERT INTO students (student_id, first_name, last_name, active, attendance_required_from_date) VALUES (?, ?, ?, ?, ?)")
    .bind(memberId, firstName, lastName, active, attendanceRequiredFromDate)
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

function insertMeeting(
  env: Env,
  meetingDate: string,
  required = 1,
  title = `Meeting ${meetingDate}`,
  startsAt: string | null = null,
  endsAt: string | null = null
) {
  return env.DB.prepare(
    "INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    `meeting-${meetingDate}`,
    meetingDate,
    title,
    required,
    startsAt,
    endsAt,
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
