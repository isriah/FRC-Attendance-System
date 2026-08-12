import { meetingDateForTimestamp, requireIsoDate } from "@frc-attendance/shared";
import type { Env } from "./env";
import { buildMeetingAbsenceReport, buildMeetingSummaryReport, buildMemberAttendanceReport } from "./reports";

const meetingAbsenceKind = "meeting_absence";
const memberAttendanceReportKind = "member_attendance_report";

export interface MeetingAbsenceNotificationInput {
  meetingDate?: unknown;
  preview?: unknown;
  resend?: unknown;
}

export interface MemberAttendanceReportNotificationInput {
  memberId?: unknown;
  preview?: unknown;
  resend?: unknown;
}

export interface MeetingAbsenceNotificationResult {
  meetingDate: string;
  title: string | null;
  notificationKind: typeof meetingAbsenceKind;
  providerConfigured: boolean;
  mode: "preview" | "send";
  sentCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  recipients: NotificationRecipient[];
  missingEmail: MissingEmailRecipient[];
  warnings: string[];
}

export interface MemberAttendanceReportNotificationResult {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  reportDate: string;
  notificationKind: typeof memberAttendanceReportKind;
  providerConfigured: boolean;
  mode: "preview" | "send";
  sentCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  recipient: NotificationRecipient | null;
  missingEmail: MissingEmailRecipient[];
  report: {
    attendanceRate: number | null;
    totalMeetings: number;
    presentMeetings: number;
    missedMeetings: number;
    missedMeetingsList: Array<{ meetingDate: string; title: string | null }>;
    optionalMeetings: Array<{ meetingDate: string; title: string | null; attended: boolean }>;
  };
  warnings: string[];
}

export interface NotificationRecipient {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "would_send" | "sent" | "error" | "skipped_duplicate";
  error?: string;
}

export interface MissingEmailRecipient {
  memberId: string;
  firstName: string;
  lastName: string;
  status: "missing_email";
}

interface EmailProvider {
  configured: boolean;
  send: (message: EmailMessage) => Promise<{ providerMessageId?: string }>;
}

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata: Record<string, string>;
}

export async function sendMeetingAbsenceNotifications(
  env: Env,
  input: MeetingAbsenceNotificationInput,
  now = new Date()
): Promise<MeetingAbsenceNotificationResult> {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const preview = input.preview === undefined ? false : requireBoolean(input.preview, "preview");
  const resend = input.resend === undefined ? false : requireBoolean(input.resend, "resend");
  const meeting = await getRequiredCompletedMeeting(env, meetingDate, now);
  const absenceReport = await buildMeetingAbsenceReport(env, meetingDate, now);
  const absences = await hydrateAbsenceEmails(env, absenceReport.rows);
  const provider = emailProvider(env);
  const mode = preview || !provider.configured ? "preview" : "send";
  const sentKeys = resend ? new Set<string>() : await sentNotificationKeys(env, meetingAbsenceKind, meetingDate);
  const recipients: NotificationRecipient[] = [];
  const missingEmail: MissingEmailRecipient[] = [];
  const warnings: string[] = [];

  if (!provider.configured) warnings.push("Email provider is not configured; showing preview only.");
  if (resend) warnings.push("Resend enabled; previously sent recipients are included.");

  for (const row of absences) {
    const email = row.email;
    if (!email) {
      missingEmail.push({
        memberId: row.memberId,
        firstName: row.firstName,
        lastName: row.lastName,
        status: "missing_email"
      });
      continue;
    }

    const duplicate = sentKeys.has(notificationKey(row.memberId, email));
    const recipient: NotificationRecipient = {
      memberId: row.memberId,
      firstName: row.firstName,
      lastName: row.lastName,
      email,
      status: duplicate ? "skipped_duplicate" : mode === "preview" ? "would_send" : "sent"
    };

    if (mode === "send" && !duplicate) {
      try {
        const delivery = await provider.send(buildAbsenceEmail(meeting, { ...row, email }));
        await recordNotificationDelivery(env, {
          notificationKind: meetingAbsenceKind,
          meetingDate,
          memberId: row.memberId,
          email,
          status: "sent",
          providerMessageId: delivery.providerMessageId
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recipient.status = "error";
        recipient.error = message;
        await recordNotificationDelivery(env, {
          notificationKind: meetingAbsenceKind,
          meetingDate,
          memberId: row.memberId,
          email,
          status: "error",
          errorMessage: message
        });
      }
    }

    recipients.push(recipient);
  }

  return {
    meetingDate,
    title: meeting.title,
    notificationKind: meetingAbsenceKind,
    providerConfigured: provider.configured,
    mode,
    sentCount: recipients.filter((recipient) => recipient.status === "sent").length,
    skippedDuplicateCount: recipients.filter((recipient) => recipient.status === "skipped_duplicate").length,
    errorCount: recipients.filter((recipient) => recipient.status === "error").length,
    recipients,
    missingEmail,
    warnings
  };
}

export async function sendMemberAttendanceReportNotification(
  env: Env,
  input: MemberAttendanceReportNotificationInput,
  now = new Date()
): Promise<MemberAttendanceReportNotificationResult> {
  const memberId = requireNonEmptyString(input.memberId, "memberId");
  const preview = input.preview === undefined ? false : requireBoolean(input.preview, "preview");
  const resend = input.resend === undefined ? false : requireBoolean(input.resend, "resend");
  const [member, report, meetingSummary] = await Promise.all([
    getMemberEmail(env, memberId),
    buildMemberAttendanceReport(env, memberId, {}, now),
    buildMeetingSummaryReport(env, {}, 500, now)
  ]);
  const reportDate = meetingDateForTimestamp(now.toISOString(), env.TIME_ZONE);
  const provider = emailProvider(env);
  const mode = preview || !provider.configured ? "preview" : "send";
  const warnings: string[] = [];
  const missingEmail: MissingEmailRecipient[] = [];
  let recipient: NotificationRecipient | null = null;

  if (!provider.configured) warnings.push("Email provider is not configured; showing preview only.");
  if (resend) warnings.push("Resend enabled; previously sent attendance reports for this member are included.");

  const meetingsByDate = new Map(meetingSummary.map((meeting) => [meeting.meetingDate, meeting]));
  const missedMeetingsList = report.absentDates.map((date) => ({
    meetingDate: date,
    title: meetingsByDate.get(date)?.title ?? null
  }));
  const optionalSessionDates = await memberOptionalSessionDates(env, memberId);
  const optionalMeetings = meetingSummary
    .filter((meeting) => !meeting.required)
    .map((meeting) => ({
      meetingDate: meeting.meetingDate,
      title: meeting.title,
      attended: optionalSessionDates.has(meeting.meetingDate)
    }));
  const email = normalizeOptionalEmail(member.email);

  if (!email) {
    missingEmail.push({
      memberId: report.memberId,
      firstName: report.firstName,
      lastName: report.lastName,
      status: "missing_email"
    });
  } else {
    const sentKeys = resend ? new Set<string>() : await sentNotificationKeys(env, memberAttendanceReportKind, reportDate);
    const duplicate = sentKeys.has(notificationKey(report.memberId, email));
    recipient = {
      memberId: report.memberId,
      firstName: report.firstName,
      lastName: report.lastName,
      email,
      status: duplicate ? "skipped_duplicate" : mode === "preview" ? "would_send" : "sent"
    };

    if (mode === "send" && !duplicate) {
      try {
        const delivery = await provider.send(buildMemberAttendanceEmail({
          ...report,
          email,
          reportDate,
          missedMeetingsList,
          optionalMeetings
        }));
        await recordNotificationDelivery(env, {
          notificationKind: memberAttendanceReportKind,
          meetingDate: reportDate,
          memberId: report.memberId,
          email,
          status: "sent",
          providerMessageId: delivery.providerMessageId
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recipient.status = "error";
        recipient.error = message;
        await recordNotificationDelivery(env, {
          notificationKind: memberAttendanceReportKind,
          meetingDate: reportDate,
          memberId: report.memberId,
          email,
          status: "error",
          errorMessage: message
        });
      }
    }
  }

  return {
    memberId: report.memberId,
    firstName: report.firstName,
    lastName: report.lastName,
    email,
    reportDate,
    notificationKind: memberAttendanceReportKind,
    providerConfigured: provider.configured,
    mode,
    sentCount: recipient?.status === "sent" ? 1 : 0,
    skippedDuplicateCount: recipient?.status === "skipped_duplicate" ? 1 : 0,
    errorCount: recipient?.status === "error" ? 1 : 0,
    recipient,
    missingEmail,
    report: {
      attendanceRate: report.attendanceRate,
      totalMeetings: report.totalMeetings,
      presentMeetings: report.presentMeetings,
      missedMeetings: report.missedMeetings,
      missedMeetingsList,
      optionalMeetings
    },
    warnings
  };
}

async function getRequiredCompletedMeeting(env: Env, meetingDate: string, now: Date) {
  const meeting = await env.DB.prepare(`
    SELECT meeting_date, title, required, starts_at, ends_at
    FROM scheduled_meetings
    WHERE meeting_date = ?
  `).bind(meetingDate).first<{
    meeting_date: string;
    title: string | null;
    required: number;
    starts_at: string | null;
    ends_at: string | null;
  }>();

  if (!meeting) throw Object.assign(new Error("Scheduled meeting not found"), { status: 404 });
  if (!meeting.required) throw Object.assign(new Error("Only required meetings can send missed-meeting emails"), { status: 400 });
  if (!isMeetingComplete(meeting, env, now)) {
    throw Object.assign(new Error("Meeting must be completed before missed-meeting emails can be sent"), { status: 400 });
  }
  return meeting;
}

async function hydrateAbsenceEmails(env: Env, rows: Array<{ memberId: string; firstName: string; lastName: string }>) {
  const activeStudents = await env.DB.prepare(`
    SELECT student_id, email
    FROM students
    WHERE active = 1
  `).all<{ student_id: string; email: string | null }>();
  const emailByMemberId = new Map(activeStudents.results.map((row) => [row.student_id, normalizeOptionalEmail(row.email)]));
  return rows.map((row) => ({
    ...row,
    email: emailByMemberId.get(row.memberId) ?? null
  }));
}

function emailProvider(env: Env): EmailProvider {
  const fromAddress = normalizeOptionalEmail(env.EMAIL_FROM_ADDRESS);
  const resendApiKey = env.RESEND_API_KEY?.trim();
  if (resendApiKey && fromAddress) return resendEmailProvider(env, resendApiKey, fromAddress);

  const url = env.EMAIL_PROVIDER_URL?.trim();
  if (url && fromAddress) return genericHttpEmailProvider(env, url, fromAddress);

  return {
    configured: false,
    async send() {
      throw new Error("Email provider is not configured");
    }
  };
}

function resendEmailProvider(env: Env, apiKey: string, fromAddress: string): EmailProvider {
  return {
    configured: true,
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey(message)
        },
        body: JSON.stringify({
          from: formatFromAddress(fromAddress, env.EMAIL_FROM_NAME),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text
        })
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || `Resend returned ${response.status}`);
      return { providerMessageId: providerMessageIdFromResponse(text) };
    }
  };
}

function genericHttpEmailProvider(env: Env, url: string, fromAddress: string): EmailProvider {
  return {
    configured: true,
    async send(message) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.EMAIL_PROVIDER_API_KEY ? { authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}` } : {})
        },
        body: JSON.stringify({
          from: {
            email: fromAddress,
            name: env.EMAIL_FROM_NAME?.trim() || "FRC Attendance"
          },
          to: [{ email: message.to }],
          subject: message.subject,
          text: message.text,
          html: message.html,
          metadata: message.metadata
        })
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || `Email provider returned ${response.status}`);
      return { providerMessageId: providerMessageIdFromResponse(text) };
    }
  };
}

function formatFromAddress(fromAddress: string, fromName?: string) {
  const name = fromName?.trim() || "FRC Attendance";
  return `${name} <${fromAddress}>`;
}

function idempotencyKey(message: EmailMessage) {
  const kind = message.metadata.notificationKind ?? "notification";
  const meetingDate = message.metadata.meetingDate ?? "unknown-date";
  const memberId = message.metadata.memberId ?? "unknown-member";
  return `${kind}:${meetingDate}:${memberId}:${message.to.trim().toLowerCase()}`;
}

function buildAbsenceEmail(meeting: { meeting_date: string; title: string | null }, member: { memberId: string; firstName: string; email: string }) {
  const meetingLabel = meeting.title ?? `meeting on ${meeting.meeting_date}`;
  const subject = `Missed meeting: ${meetingLabel}`;
  const text = [
    `Hi ${member.firstName},`,
    "",
    `Our attendance records show that you missed ${meetingLabel} on ${meeting.meeting_date}.`,
    "If this looks wrong, please contact a mentor so they can correct the attendance record.",
    "",
    "FRC Attendance"
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(member.firstName)},</p>`,
    `<p>Our attendance records show that you missed ${escapeHtml(meetingLabel)} on ${meeting.meeting_date}.</p>`,
    "<p>If this looks wrong, please contact a mentor so they can correct the attendance record.</p>",
    "<p>FRC Attendance</p>"
  ].join("");
  return {
    to: member.email,
    subject,
    text,
    html,
    metadata: {
      notificationKind: meetingAbsenceKind,
      meetingDate: meeting.meeting_date,
      memberId: member.memberId
    }
  };
}

function buildMemberAttendanceEmail(member: {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  reportDate: string;
  attendanceRate: number | null;
  totalMeetings: number;
  presentMeetings: number;
  missedMeetings: number;
  missedMeetingsList: Array<{ meetingDate: string; title: string | null }>;
  optionalMeetings: Array<{ meetingDate: string; title: string | null; attended: boolean }>;
}) {
  const attendance = formatPercent(member.attendanceRate);
  const subject = `Attendance report for ${member.firstName} ${member.lastName}`;
  const missedText = member.missedMeetingsList.length > 0
    ? member.missedMeetingsList.map((meeting) => `- ${meeting.meetingDate}: ${meeting.title ?? "Required meeting"}`).join("\n")
    : "None";
  const optionalText = member.optionalMeetings.length > 0
    ? member.optionalMeetings.map((meeting) => `- ${meeting.meetingDate}: ${meeting.title ?? "Optional meeting"} (${meeting.attended ? "attended" : "not required"})`).join("\n")
    : "None available";
  const missedHtml = member.missedMeetingsList.length > 0
    ? `<ul>${member.missedMeetingsList.map((meeting) => `<li>${meeting.meetingDate}: ${escapeHtml(meeting.title ?? "Required meeting")}</li>`).join("")}</ul>`
    : "<p>None</p>";
  const optionalHtml = member.optionalMeetings.length > 0
    ? `<ul>${member.optionalMeetings.map((meeting) => `<li>${meeting.meetingDate}: ${escapeHtml(meeting.title ?? "Optional meeting")} (${meeting.attended ? "attended" : "not required"})</li>`).join("")}</ul>`
    : "<p>None available</p>";
  const text = [
    `Hi ${member.firstName},`,
    "",
    `Here is your current FRC attendance report as of ${member.reportDate}.`,
    "",
    `Member: ${member.firstName} ${member.lastName} (${member.memberId})`,
    `Required attendance: ${attendance}`,
    `Completed required meetings: ${member.totalMeetings}`,
    `Attended: ${member.presentMeetings}`,
    `Missed: ${member.missedMeetings}`,
    "",
    "Missed required meetings:",
    missedText,
    "",
    "Optional/not-required meetings:",
    optionalText,
    "",
    "Future and in-progress meetings are not included in required attendance counts.",
    "If this looks wrong, please contact a mentor so they can correct the attendance record.",
    "",
    "FRC Attendance"
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(member.firstName)},</p>`,
    `<p>Here is your current FRC attendance report as of ${member.reportDate}.</p>`,
    "<dl>",
    `<dt>Member</dt><dd>${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)} (${escapeHtml(member.memberId)})</dd>`,
    `<dt>Required attendance</dt><dd>${attendance}</dd>`,
    `<dt>Completed required meetings</dt><dd>${member.totalMeetings}</dd>`,
    `<dt>Attended</dt><dd>${member.presentMeetings}</dd>`,
    `<dt>Missed</dt><dd>${member.missedMeetings}</dd>`,
    "</dl>",
    "<h2>Missed required meetings</h2>",
    missedHtml,
    "<h2>Optional/not-required meetings</h2>",
    optionalHtml,
    "<p>Future and in-progress meetings are not included in required attendance counts.</p>",
    "<p>If this looks wrong, please contact a mentor so they can correct the attendance record.</p>",
    "<p>FRC Attendance</p>"
  ].join("");
  return {
    to: member.email,
    subject,
    text,
    html,
    metadata: {
      notificationKind: memberAttendanceReportKind,
      meetingDate: member.reportDate,
      memberId: member.memberId
    }
  };
}

async function sentNotificationKeys(env: Env, notificationKind: string, meetingDate: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`
    SELECT student_id, recipient_email
    FROM notification_deliveries
    WHERE notification_kind = ? AND meeting_date = ? AND status = 'sent'
  `).bind(notificationKind, meetingDate).all<{ student_id: string; recipient_email: string }>();
  return new Set(rows.results.map((row) => notificationKey(row.student_id, row.recipient_email)));
}

async function recordNotificationDelivery(env: Env, delivery: {
  notificationKind: string;
  meetingDate: string;
  memberId: string;
  email: string;
  status: "sent" | "error";
  providerMessageId?: string;
  errorMessage?: string;
}) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO notification_deliveries (
      id,
      notification_kind,
      meeting_date,
      student_id,
      recipient_email,
      status,
      provider_message_id,
      error_message,
      sent_at,
      error_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    delivery.notificationKind,
    delivery.meetingDate,
    delivery.memberId,
    delivery.email,
    delivery.status,
    delivery.providerMessageId ?? null,
    delivery.errorMessage ?? null,
    delivery.status === "sent" ? now : null,
    delivery.status === "error" ? now : null,
    now,
    now
  ).run();
}

async function getMemberEmail(env: Env, memberId: string) {
  const member = await env.DB.prepare(`
    SELECT student_id, email
    FROM students
    WHERE student_id = ?
  `).bind(memberId).first<{ student_id: string; email: string | null }>();
  if (!member) throw Object.assign(new Error("Member not found"), { status: 404 });
  return member;
}

async function memberOptionalSessionDates(env: Env, memberId: string) {
  const rows = await env.DB.prepare(`
    SELECT DISTINCT attendance_sessions.meeting_date
    FROM attendance_sessions
    INNER JOIN scheduled_meetings ON scheduled_meetings.meeting_date = attendance_sessions.meeting_date
    WHERE attendance_sessions.student_id = ? AND scheduled_meetings.required = 0
  `).bind(memberId).all<{ meeting_date: string }>();
  return new Set(rows.results.map((row) => row.meeting_date));
}

function providerMessageIdFromResponse(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    const json = JSON.parse(text) as { id?: unknown; messageId?: unknown; message_id?: unknown };
    const id = json.id ?? json.messageId ?? json.message_id;
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
  } catch {
    return undefined;
  }
}

function notificationKey(memberId: string, email: string) {
  return `${memberId}:${email.trim().toLowerCase()}`;
}

function normalizeOptionalEmail(value?: string | null) {
  const email = value?.trim().toLowerCase() ?? "";
  return email.length > 0 ? email : null;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") throw Object.assign(new Error(`${fieldName} must be a boolean`), { status: 400 });
  return value;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`${fieldName} is required`), { status: 400 });
  }
  return value.trim();
}

function formatPercent(value: number | null) {
  return value === null ? "N/A" : `${Math.round(value * 100)}%`;
}

function isMeetingComplete(meeting: { meeting_date: string; ends_at: string | null }, env: Env, now: Date): boolean {
  if (meeting.ends_at) return new Date(meeting.ends_at).getTime() <= now.getTime();
  return meeting.meeting_date <= meetingDateForTimestamp(now.toISOString(), env.TIME_ZONE);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
