import type { Env } from "./env";
import { buildMemberAttendanceReport } from "./reports";

export async function buildLegacySheetExport(env: Env) {
  const sessions = await env.DB.prepare(
    "SELECT student_id, meeting_date, check_in_at, check_out_at FROM attendance_sessions ORDER BY student_id, meeting_date"
  ).all<{ student_id: string; meeting_date: string; check_in_at: string; check_out_at: string | null }>();
  const meetings = await env.DB.prepare(
    "SELECT meeting_date, title, required, starts_at, ends_at FROM scheduled_meetings ORDER BY meeting_date"
  ).all<{ meeting_date: string; title: string; required: number; starts_at: string | null; ends_at: string | null }>();
  const activeStudents = await env.DB.prepare(
    "SELECT student_id FROM students WHERE active = 1 ORDER BY student_id"
  ).all<{ student_id: string }>();

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
  const memberSummaryRows = await Promise.all(activeStudents.results.map(async (student) => {
    const report = await buildMemberAttendanceReport(env, student.student_id);
    return [
      report.studentId,
      report.firstName,
      report.lastName,
      report.totalMeetings,
      report.presentMeetings,
      report.missedMeetings,
      report.attendanceRate === null ? "" : Math.round(report.attendanceRate * 1000) / 1000,
      report.presentDates.map(formatLegacyDate).join(", "),
      report.absentDates.map(formatLegacyDate).join(", ")
    ];
  }));

  return {
    generatedAt: new Date().toISOString(),
    ranges: {
      AttendanceLogIn: logInRows,
      AttendanceLogOut: logOutRows,
      ScheduledMeetings: meetingRows,
      MemberAttendanceSummary: memberSummaryRows
    }
  };
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
