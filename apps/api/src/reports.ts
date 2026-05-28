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
    "SELECT DISTINCT meeting_date FROM attendance_sessions ORDER BY meeting_date"
  ).all<{ meeting_date: string }>();
  const sessions = await env.DB.prepare(
    "SELECT meeting_date, status FROM attendance_sessions WHERE student_id = ? ORDER BY meeting_date"
  ).bind(studentId).all<{ meeting_date: string; status: "open" | "closed" }>();

  const presentDates = [...new Set(sessions.results.map((session) => session.meeting_date))];
  const presentDateSet = new Set(presentDates);
  const allDates = meetingDates.results.map((row) => row.meeting_date);
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
    openSessionDates: sessions.results.filter((session) => session.status === "open").map((session) => session.meeting_date)
  };
}
