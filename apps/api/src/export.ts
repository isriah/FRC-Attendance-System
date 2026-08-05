import type { Env } from "./env";
import { buildMeetingAbsenceReport, buildMeetingSummaryReport, buildRosterAttendanceSummary, type ReportDateRange } from "./reports";

export async function buildLegacySheetExport(env: Env, range: ReportDateRange = {}) {
  const sessions = await env.DB.prepare(
    `
      SELECT student_id, meeting_date, check_in_at, check_out_at
      FROM attendance_sessions
      ${whereDateRange("meeting_date", range)}
      ORDER BY student_id, meeting_date
    `
  ).bind(...dateRangeParams(range)).all<{ student_id: string; meeting_date: string; check_in_at: string; check_out_at: string | null }>();
  const meetings = await env.DB.prepare(
    `
      SELECT meeting_date, title, required, starts_at, ends_at
      FROM scheduled_meetings
      ${whereDateRange("meeting_date", range)}
      ORDER BY meeting_date
    `
  ).bind(...dateRangeParams(range)).all<{ meeting_date: string; title: string; required: number; starts_at: string | null; ends_at: string | null }>();
  const [meetingSummary, rosterAttendance] = await Promise.all([
    buildMeetingSummaryReport(env, range),
    buildRosterAttendanceSummary(env, range)
  ]);
  const requiredMeetingAbsences = await Promise.all(
    meetingSummary.filter((meeting) => meeting.required).map((meeting) => buildMeetingAbsenceReport(env, meeting.meetingDate))
  );

  const logInRows = sessions.results.map((session) => [
    session.student_id,
    formatLegacyDate(session.meeting_date),
    formatLegacyTime(session.check_in_at)
  ]);
  const logOutRows = sessions.results
    .filter((session) => Boolean(session.check_out_at))
    .map((session) => [
      session.student_id,
      formatLegacyDate(session.meeting_date),
      formatLegacyTime(session.check_out_at as string)
    ]);
  const sessionCountsByDate = sessions.results.reduce<Map<string, number>>((counts, session) => {
    counts.set(session.meeting_date, (counts.get(session.meeting_date) ?? 0) + 1);
    return counts;
  }, new Map());
  const meetingRows = meetings.results.map((meeting) => [
    formatLegacyDate(meeting.meeting_date),
    meeting.title,
    meeting.required ? "required" : "optional",
    meeting.starts_at ? formatLegacyTime(meeting.starts_at) : "",
    meeting.ends_at ? formatLegacyTime(meeting.ends_at) : "",
    sessionCountsByDate.get(meeting.meeting_date) ?? 0
  ]);
  const rosterAttendanceRows = rosterAttendance.map((report) => [
    report.studentId,
    report.firstName,
    report.lastName,
    report.requiredMeetings,
    report.presentMeetings,
    report.missedMeetings,
    formatRate(report.attendanceRate),
    report.lastSeenAt ? formatLegacyDate(report.lastSeenAt.slice(0, 10)) : "",
    report.openSessionWarning ? "open check-in" : ""
  ]);
  const meetingSummaryRows = meetingSummary.map((meeting) => [
    formatLegacyDate(meeting.meetingDate),
    meeting.title ?? "Unscheduled attendance",
    meeting.required ? "required" : "optional",
    meeting.startsAt ? formatLegacyTime(meeting.startsAt) : "",
    meeting.endsAt ? formatLegacyTime(meeting.endsAt) : "",
    meeting.scheduled ? "scheduled" : "attendance-only",
    meeting.presentCount,
    meeting.required ? meeting.absentCount : "",
    meeting.openCheckIns,
    meeting.zeroScan ? "zero scans" : ""
  ]);
  const meetingAbsenceRows = requiredMeetingAbsences.flatMap((meeting) => meeting.rows.map((student) => [
    formatLegacyDate(meeting.meetingDate),
    meeting.title ?? "Required attendance",
    student.studentId,
    student.firstName,
    student.lastName
  ]));

  return {
    generatedAt: new Date().toISOString(),
    ranges: {
      MeetingSummary: meetingSummaryRows,
      MeetingAbsences: meetingAbsenceRows,
      RosterAttendance: rosterAttendanceRows,
      AttendanceLogIn: logInRows,
      AttendanceLogOut: logOutRows,
      ScheduledMeetings: meetingRows,
      MemberAttendanceSummary: rosterAttendanceRows
    }
  };
}

function formatRate(rate: number | null): number | "" {
  return rate === null ? "" : Math.round(rate * 1000) / 1000;
}

function formatLegacyDate(meetingDate: string): string {
  const [year, month, day] = meetingDate.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

function formatLegacyTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York"
  }).format(new Date(iso));
}

function whereDateRange(column: string, range: ReportDateRange): string {
  const clauses: string[] = [];
  if (range.startDate) clauses.push(`${column} >= ?`);
  if (range.endDate) clauses.push(`${column} <= ?`);
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function dateRangeParams(range: ReportDateRange): string[] {
  return [range.startDate, range.endDate].filter((value): value is string => Boolean(value));
}
