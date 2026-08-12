import { meetingDateForTimestamp, requireIsoDate } from "@frc-attendance/shared";
import type { Env } from "./env";

export interface ReportDateRange {
  startDate?: string;
  endDate?: string;
}

export interface PresenceReportRow {
  memberId: string;
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
  member_id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  status: "open" | "closed" | "scheduled";
}

export interface MemberAttendanceReport {
  memberId: string;
  firstName: string;
  lastName: string;
  startDate?: string;
  endDate?: string;
  totalMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  attendanceRate: number | null;
  lastSeenAt?: string;
  presentDates: string[];
  absentDates: string[];
  openSessionDates: string[];
}

export interface MeetingSummaryReportRow {
  meetingDate: string;
  title: string | null;
  required: boolean;
  startsAt?: string;
  endsAt?: string;
  scheduled: boolean;
  hasAttendance: boolean;
  zeroScan: boolean;
  presentCount: number;
  activePresentCount: number;
  absentCount: number;
  openCheckIns: number;
}

export interface MeetingAbsenceReport {
  meetingDate: string;
  title: string | null;
  required: boolean;
  startsAt?: string;
  endsAt?: string;
  absentCount: number;
  rows: Array<{
    memberId: string;
    firstName: string;
    lastName: string;
  }>;
}

export interface RosterAttendanceSummaryRow {
  memberId: string;
  firstName: string;
  lastName: string;
  requiredMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  attendanceRate: number | null;
  lastSeenAt?: string;
  openSessionDates: string[];
  openSessionWarning: boolean;
}

export function reportDateRangeFromSearchParams(searchParams: URLSearchParams): ReportDateRange {
  const range: ReportDateRange = {};
  const startDate = optionalIsoDate(searchParams.get("startDate"), "startDate");
  const endDate = optionalIsoDate(searchParams.get("endDate"), "endDate");
  if (startDate) range.startDate = startDate;
  if (endDate) range.endDate = endDate;
  if (range.startDate && range.endDate && range.startDate > range.endDate) {
    throw Object.assign(new Error("startDate must be on or before endDate"), { status: 400 });
  }
  return range;
}

export async function buildAttendanceSessionReport(env: Env, range: ReportDateRange = {}, limit = 500, now = new Date()): Promise<AttendanceSessionReportRow[]> {
  const scheduledMeetings = await env.DB.prepare(`
    SELECT meeting_date, title, required, ends_at
    FROM scheduled_meetings
    ${whereDateRange("meeting_date", range)}
    ORDER BY meeting_date DESC
  `).bind(...dateRangeParams(range)).all<{ meeting_date: string; title: string; required: number; ends_at: string | null }>();
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
    ${whereDateRange("attendance_sessions.meeting_date", range)}
    ORDER BY attendance_sessions.meeting_date DESC, attendance_sessions.student_id
  `).bind(...dateRangeParams(range)).all<{
    student_id: string;
    meeting_date: string;
    check_in_at: string;
    check_out_at: string | null;
    status: "open" | "closed";
    meeting_title: string | null;
    required: number;
  }>();

  const incompleteScheduledDates = new Set(scheduledMeetings.results
    .filter((meeting) => !isMeetingComplete(meeting, env, now))
    .map((meeting) => meeting.meeting_date));
  const completedScheduledMeetings = scheduledMeetings.results.filter((meeting) => !incompleteScheduledDates.has(meeting.meeting_date));
  const reportDate = currentReportDate(env, now);
  const visibleSessions = sessions.results.filter((session) => (
    isReportDateComplete(session.meeting_date, reportDate) && !incompleteScheduledDates.has(session.meeting_date)
  ));
  const sessionDates = new Set(visibleSessions.map((session) => session.meeting_date));
  const sessionRows: AttendanceSessionReportRow[] = visibleSessions.map((session) => ({
    meeting_date: session.meeting_date,
    meeting_title: session.meeting_title,
    required: Number(session.required),
    has_attendance: 1,
    member_id: session.student_id,
    check_in_at: session.check_in_at,
    check_out_at: session.check_out_at,
    status: session.status
  }));
  const zeroScanRows: AttendanceSessionReportRow[] = completedScheduledMeetings
    .filter((meeting) => !sessionDates.has(meeting.meeting_date))
    .map((meeting) => ({
      meeting_date: meeting.meeting_date,
      meeting_title: meeting.title,
      required: Number(meeting.required),
      has_attendance: 0,
      member_id: null,
      check_in_at: null,
      check_out_at: null,
      status: "scheduled"
    }));

  return [...sessionRows, ...zeroScanRows]
    .sort((left, right) => right.meeting_date.localeCompare(left.meeting_date) || String(left.member_id ?? "").localeCompare(String(right.member_id ?? "")))
    .slice(0, limit);
}

export async function buildMeetingSummaryReport(env: Env, range: ReportDateRange = {}, limit = 500, now = new Date()): Promise<MeetingSummaryReportRow[]> {
  const [scheduledMeetings, sessions, activeStudentCount, hasScheduledMeetings] = await Promise.all([
    env.DB.prepare(`
      SELECT meeting_date, title, required, starts_at, ends_at
      FROM scheduled_meetings
      ${whereDateRange("meeting_date", range)}
      ORDER BY meeting_date DESC
    `).bind(...dateRangeParams(range)).all<{
      meeting_date: string;
      title: string;
      required: number;
      starts_at: string | null;
      ends_at: string | null;
    }>(),
    env.DB.prepare(`
      SELECT
        attendance_sessions.meeting_date,
        COUNT(DISTINCT attendance_sessions.student_id) AS present_count,
        COUNT(DISTINCT CASE WHEN students.active = 1 THEN attendance_sessions.student_id END) AS active_present_count,
        SUM(CASE WHEN attendance_sessions.status = 'open' THEN 1 ELSE 0 END) AS open_check_ins
      FROM attendance_sessions
      LEFT JOIN students ON students.student_id = attendance_sessions.student_id
      ${whereDateRange("meeting_date", range)}
      GROUP BY attendance_sessions.meeting_date
      ORDER BY attendance_sessions.meeting_date DESC
    `).bind(...dateRangeParams(range)).all<{
      meeting_date: string;
      present_count: number;
      active_present_count: number;
      open_check_ins: number;
    }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM students WHERE active = 1").first<{ count: number }>(),
    hasAnyScheduledMeetings(env)
  ]);

  const activeCount = Number(activeStudentCount?.count ?? 0);
  const reportDate = currentReportDate(env, now);
  const incompleteScheduledDates = new Set(scheduledMeetings.results
    .filter((meeting) => !isMeetingComplete(meeting, env, now))
    .map((meeting) => meeting.meeting_date));
  const completedScheduledMeetings = scheduledMeetings.results.filter((meeting) => !incompleteScheduledDates.has(meeting.meeting_date));
  const visibleSessions = sessions.results.filter((session) => (
    isReportDateComplete(session.meeting_date, reportDate) && !incompleteScheduledDates.has(session.meeting_date)
  ));
  const meetingsByDate = new Map(completedScheduledMeetings.map((meeting) => [meeting.meeting_date, meeting]));
  const sessionsByDate = new Map(visibleSessions.map((session) => [session.meeting_date, session]));
  const dates = [...new Set([...meetingsByDate.keys(), ...sessionsByDate.keys()])].sort((left, right) => right.localeCompare(left));

  return dates.map((meetingDate) => {
    const meeting = meetingsByDate.get(meetingDate);
    const session = sessionsByDate.get(meetingDate);
    const scheduled = Boolean(meeting);
    const required = meeting ? Boolean(meeting.required) : !hasScheduledMeetings;
    const presentCount = Number(session?.present_count ?? 0);
    const activePresentCount = Number(session?.active_present_count ?? 0);
    return {
      meetingDate,
      title: meeting?.title ?? null,
      required,
      startsAt: meeting?.starts_at ?? undefined,
      endsAt: meeting?.ends_at ?? undefined,
      scheduled,
      hasAttendance: Boolean(session),
      zeroScan: scheduled && !session,
      presentCount,
      activePresentCount,
      absentCount: required ? Math.max(activeCount - activePresentCount, 0) : 0,
      openCheckIns: Number(session?.open_check_ins ?? 0)
    };
  }).slice(0, limit);
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
      memberId: student.student_id,
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

export async function buildMeetingAbsenceReport(env: Env, meetingDate: string, now = new Date()): Promise<MeetingAbsenceReport> {
  const date = requireIsoDate(meetingDate, "date");
  const meeting = await env.DB.prepare(`
    SELECT meeting_date, title, required, starts_at, ends_at
    FROM scheduled_meetings
    WHERE meeting_date = ?
  `).bind(date).first<{ meeting_date: string; title: string; required: number; starts_at: string | null; ends_at: string | null }>();
  const presentStudents = await env.DB.prepare(`
    SELECT DISTINCT student_id
    FROM attendance_sessions
    WHERE meeting_date = ?
  `).bind(date).all<{ student_id: string }>();
  const presentIds = new Set(presentStudents.results.map((row) => row.student_id));
  const required = meeting ? Boolean(meeting.required) : !(await hasAnyScheduledMeetings(env)) && presentIds.size > 0;
  const countAbsences = required && (!meeting || isMeetingComplete(meeting, env, now));
  const activeStudents = await env.DB.prepare(`
    SELECT student_id, first_name, last_name
    FROM students
    WHERE active = 1
    ORDER BY last_name, first_name
  `).all<{ student_id: string; first_name: string; last_name: string }>();
  const rows = countAbsences
    ? activeStudents.results
      .filter((student) => !presentIds.has(student.student_id))
      .map((student) => ({
        memberId: student.student_id,
        firstName: student.first_name,
        lastName: student.last_name
      }))
    : [];

  return {
    meetingDate: date,
    title: meeting?.title ?? null,
    required,
    startsAt: meeting?.starts_at ?? undefined,
    endsAt: meeting?.ends_at ?? undefined,
    absentCount: rows.length,
    rows
  };
}

export async function buildRosterAttendanceSummary(env: Env, range: ReportDateRange = {}, now = new Date()): Promise<RosterAttendanceSummaryRow[]> {
  const activeStudents = await env.DB.prepare(`
    SELECT student_id, first_name, last_name
    FROM students
    WHERE active = 1
    ORDER BY last_name, first_name
  `).all<{ student_id: string; first_name: string; last_name: string }>();

  return Promise.all(activeStudents.results.map(async (student) => {
    const report = await buildMemberAttendanceReport(env, student.student_id, range, now);
    return {
      memberId: report.memberId,
      firstName: report.firstName,
      lastName: report.lastName,
      requiredMeetings: report.totalMeetings,
      presentMeetings: report.presentMeetings,
      missedMeetings: report.missedMeetings,
      attendanceRate: report.attendanceRate,
      lastSeenAt: report.lastSeenAt,
      openSessionDates: report.openSessionDates,
      openSessionWarning: report.openSessionDates.length > 0
    };
  }));
}

export async function buildMemberAttendanceReport(env: Env, memberId: string, range: ReportDateRange = {}, now = new Date()): Promise<MemberAttendanceReport> {
  const student = await env.DB.prepare(
    "SELECT student_id, first_name, last_name FROM students WHERE student_id = ?"
  ).bind(memberId).first<{ student_id: string; first_name: string; last_name: string }>();
  if (!student) throw Object.assign(new Error("Member not found"), { status: 404 });

  const meetingDates = await requiredMeetingDates(env, range, now);
  const sessions = await env.DB.prepare(
    `
      SELECT meeting_date, status, check_in_at
      FROM attendance_sessions
      WHERE student_id = ?
      ${whereDateRange("meeting_date", range, "AND")}
      ORDER BY meeting_date
    `
  ).bind(memberId, ...dateRangeParams(range)).all<{ meeting_date: string; status: "open" | "closed"; check_in_at: string }>();

  const allDates = [...new Set(meetingDates.map((row) => row.meeting_date))];
  const allDateSet = new Set(allDates);
  const presentDates = [...new Set(sessions.results.map((session) => session.meeting_date))].filter((date) => allDateSet.has(date));
  const presentDateSet = new Set(presentDates);
  const absentDates = allDates.filter((date) => !presentDateSet.has(date));
  const attendanceRate = allDates.length === 0 ? null : presentDates.length / allDates.length;
  const lastSeenAt = sessions.results.reduce<string | undefined>((latest, session) => {
    if (!latest || session.check_in_at > latest) return session.check_in_at;
    return latest;
  }, undefined);

  return {
    memberId: student.student_id,
    firstName: student.first_name,
    lastName: student.last_name,
    startDate: range.startDate,
    endDate: range.endDate,
    totalMeetings: allDates.length,
    presentMeetings: presentDates.length,
    missedMeetings: absentDates.length,
    attendanceRate,
    lastSeenAt,
    presentDates,
    absentDates,
    openSessionDates: sessions.results.filter((session) => session.status === "open" && allDateSet.has(session.meeting_date)).map((session) => session.meeting_date)
  };
}

async function requiredMeetingDates(env: Env, range: ReportDateRange, now: Date) {
  if (await hasAnyScheduledMeetings(env)) {
    const scheduledDates = await env.DB.prepare(`
      SELECT meeting_date, ends_at
      FROM scheduled_meetings
      WHERE required = 1
      ${whereDateRange("meeting_date", range, "AND")}
      ORDER BY meeting_date
    `).bind(...dateRangeParams(range)).all<{ meeting_date: string; ends_at: string | null }>();
    return scheduledDates.results.filter((meeting) => isMeetingComplete(meeting, env, now));
  }

  const sessionDates = await env.DB.prepare(`
    SELECT DISTINCT meeting_date
    FROM attendance_sessions
    ${whereDateRange("meeting_date", range)}
    ORDER BY meeting_date
  `).bind(...dateRangeParams(range)).all<{ meeting_date: string }>();
  const reportDate = currentReportDate(env, now);
  return sessionDates.results.filter((row) => isReportDateComplete(row.meeting_date, reportDate));
}

async function hasAnyScheduledMeetings(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM scheduled_meetings").first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

function optionalIsoDate(value: string | null, fieldName: string): string | undefined {
  if (value === null || value === "") return undefined;
  return requireIsoDate(value, fieldName);
}

function whereDateRange(column: string, range: ReportDateRange, prefix: "WHERE" | "AND" = "WHERE"): string {
  const clauses: string[] = [];
  if (range.startDate) clauses.push(`${column} >= ?`);
  if (range.endDate) clauses.push(`${column} <= ?`);
  return clauses.length > 0 ? `${prefix} ${clauses.join(" AND ")}` : "";
}

function dateRangeParams(range: ReportDateRange): string[] {
  return [range.startDate, range.endDate].filter((value): value is string => Boolean(value));
}

function isMeetingComplete(meeting: { meeting_date: string; ends_at: string | null }, env: Env, now: Date): boolean {
  if (meeting.ends_at) return new Date(meeting.ends_at).getTime() <= now.getTime();
  return isReportDateComplete(meeting.meeting_date, currentReportDate(env, now));
}

function isReportDateComplete(meetingDate: string, reportDate: string): boolean {
  return meetingDate <= reportDate;
}

function currentReportDate(env: Env, now: Date): string {
  return meetingDateForTimestamp(now.toISOString(), env.TIME_ZONE);
}
