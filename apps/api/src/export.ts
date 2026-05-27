import type { Env } from "./env";

export async function buildLegacySheetExport(env: Env) {
  const sessions = await env.DB.prepare(
    "SELECT student_id, meeting_date, check_in_at, check_out_at FROM attendance_sessions ORDER BY student_id, meeting_date"
  ).all<{ student_id: string; meeting_date: string; check_in_at: string; check_out_at: string | null }>();

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

  return {
    generatedAt: new Date().toISOString(),
    ranges: {
      AttendanceLogIn: logInRows,
      AttendanceLogOut: logOutRows
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
