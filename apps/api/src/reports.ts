import { meetingDateForTimestamp } from "@frc-attendance/shared";
import type { Env } from "./env";

export interface PresenceReportRow {
  studentId: string;
  firstName: string;
  lastName: string;
  status: "signed_in" | "signed_out" | "not_seen";
  checkInAt?: string;
  checkOutAt?: string;
}

export interface AttendanceSessionReportRow {
  meeting_date: string;
  meeting_title: string | null;
  required: number;
  has_attendance: number;
  student_id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  status: "open" | "closed" | "scheduled";
}

export interface MemberAttendanceReport {
  studentId: string;
  firstName: string;
  lastName: string;
  totalMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  attendanceRate: number | null;
  presentDates: string[];
  absentDates: string[];
  openSessionDates: string[];
}

export async function buildAttendanceSessionReport(env: Env, limit = 500): Promise<AttendanceSessionReportRow[]> {
  const scheduledMeetings = await env.DB.prepare(`
    SELECT meeting_date, title, required
    FROM scheduled_meetings
    ORDER BY meeting_date DESC
  `).all<{ meeting_date: string; title: string; required: number }>();
  const sessions = await env.DB.prepare(`
    SELECT
      attendance_sessions.student_id,
      attendance_sessions.meeting_date,
      attendance_sessions.check_in_at,
      attendance_sessions.check_out_at,
      attendance_sessions.status,
      scheduled_meetings.title AS meeting_title,
      COALESCE(scheduled_meetings.required, 1) AS required
    FROM attendance_sessions
    LEFT JOIN scheduled_meetings ON scheduled_meetings.meeting_date = attendance_sessions.meeting_date
    ORDER BY attendance_sessions.meeting_date DESC, attendance_sessions.student_id
  `).all<{
    student_id: string;
    meeting_date: string;
    check_in_at: string;
    check_out_at: string | null;
    status: "open" | "closed";
    meeting_title: string | null;
    required: number;
  }>();

  const sessionDates = new Set(sessions.results.map((session) => session.meeting_date));
  const sessionRows: AttendanceSessionReportRow[] = sessions.results.map((session) => ({
    meeting_date: session.meeting_date,
    meeting_title: session.meeting_title,
    required: Number(session.required),
    has_attendance: 1,
    student_id: session.student_id,
    check_in_at: session.check_in_at,
    check_out_at: session.check_out_at,
    status: session.status
  }));
  const zeroScanRows: AttendanceSessionReportRow[] = scheduledMeetings.results
    .filter((meeting) => !sessionDates.has(meeting.meeting_date))
    .map((meeting) => ({
      meeting_date: meeting.meeting_date,
      meeting_title: meeting.title,
      required: Number(meeting.required),
      has_attendance: 0,
      student_id: null,
      check_in_at: null,
      check_out_at: null,
      status: "scheduled"
    }));

  return [...sessionRows, ...zeroScanRows]
    .sort((left, right) => right.meeting_date.localeCompare(left.meeting_date) || String(left.student_id ?? "").localeCompare(String(right.student_id ?? "")))
    .slice(0, limit);
}

export async function buildPresenceReport(env: Env, date = meetingDateForTimestamp(new Date().toISOString(), env.TIME_ZONE)) {
  const students = await env.DB.prepare(
    "SELECT student_id, first_name, last_name FROM students WHERE active = 1 ORDER BY last_name, first_name"
  ).all<{ student_id: string; first_name: string; last_name: string }>();
  const sessions = await env.DB.prepare(
    "SELECT student_id, check_in_at, check_out_at, status FROM attendance_sessions WHERE meeting_date = ?"
  ).bind(date).all<{ student_id: string; check_in_at: string; check_out_at: string | null; status: "open" | "closed" }>();

  const sessionsByStudent = new Map(sessions.results.map((session) => [session.student_id, session]));
  const rows: PresenceReportRow[] = students.results.map((student) => {
    const session = sessionsByStudent.get(student.student_id);
    return {
      studentId: student.student_id,
      firstName: student.first_name,
      lastName: student.last_name,
      status: session ? session.status === "open" ? "signed_in" : "signed_out" : "not_seen",
      checkInAt: session?.check_in_at,
      checkOutAt: session?.check_out_at ?? undefined
    };
  });

  return {
    date,
    counts: {
      signedIn: rows.filter((row) => row.status === "signed_in").length,
      signedOut: rows.filter((row) => row.status === "signed_out").length,
      notSeen: rows.filter((row) => row.status === "not_seen").length
    },
    rows
  };
}

export async function buildMemberAttendanceReport(env: Env, studentId: string): Promise<MemberAttendanceReport> {
  const student = await env.DB.prepare(
    "SELECT student_id, first_name, last_name FROM students WHERE student_id = ?"
  ).bind(studentId).first<{ student_id: string; first_name: string; last_name: string }>();
  if (!student) throw Object.assign(new Error("Member not found"), { status: 404 });

  const meetingDates = await env.DB.prepare(
    `
      SELECT meeting_date, required
      FROM (
        SELECT meeting_date, required FROM scheduled_meetings
        UNION ALL
        SELECT DISTINCT meeting_date, 1 AS required
        FROM attendance_sessions
        WHERE NOT EXISTS (SELECT 1 FROM scheduled_meetings)
      )
      ORDER BY meeting_date
    `
  ).all<{ meeting_date: string; required: number }>();
  const sessions = await env.DB.prepare(
    "SELECT meeting_date, status FROM attendance_sessions WHERE student_id = ? ORDER BY meeting_date"
  ).bind(studentId).all<{ meeting_date: string; status: "open" | "closed" }>();

  const allDates = [...new Set(meetingDates.results.filter((row) => Boolean(row.required)).map((row) => row.meeting_date))];
  const allDateSet = new Set(allDates);
  const presentDates = [...new Set(sessions.results.map((session) => session.meeting_date))].filter((date) => allDateSet.has(date));
  const presentDateSet = new Set(presentDates);
  const absentDates = allDates.filter((date) => !presentDateSet.has(date));
  const attendanceRate = allDates.length === 0 ? null : presentDates.length / allDates.length;

  return {
    studentId: student.student_id,
    firstName: student.first_name,
    lastName: student.last_name,
    totalMeetings: allDates.length,
    presentMeetings: presentDates.length,
    missedMeetings: absentDates.length,
    attendanceRate,
    presentDates,
    absentDates,
    openSessionDates: sessions.results.filter((session) => session.status === "open" && allDateSet.has(session.meeting_date)).map((session) => session.meeting_date)
  };
}
