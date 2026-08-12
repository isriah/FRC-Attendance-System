import { meetingDateForTimestamp, requireIsoDate } from "@frc-attendance/shared";
import type { Env } from "./env";
import { buildMeetingAbsenceReport } from "./reports";

const meetingAbsenceKind = "meeting_absence";

export interface MeetingAbsenceNotificationInput {
  meetingDate?: unknown;
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
  const provider = httpEmailProvider(env);
  const mode = preview || !provider.configured ? "preview" : "send";
  const sentKeys = resend ? new Set<string>() : await sentNotificationKeys(env, meetingDate);
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

function httpEmailProvider(env: Env): EmailProvider {
  const url = env.EMAIL_PROVIDER_URL?.trim();
  const fromAddress = normalizeOptionalEmail(env.EMAIL_FROM_ADDRESS);
  if (!url || !fromAddress) {
    return {
      configured: false,
      async send() {
        throw new Error("Email provider is not configured");
      }
    };
  }

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

function buildAbsenceEmail(meeting: { meeting_date: string; title: string | null }, member: { firstName: string; email: string }) {
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
      meetingDate: meeting.meeting_date
    }
  };
}

async function sentNotificationKeys(env: Env, meetingDate: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`
    SELECT student_id, recipient_email
    FROM notification_deliveries
    WHERE notification_kind = ? AND meeting_date = ? AND status = 'sent'
  `).bind(meetingAbsenceKind, meetingDate).all<{ student_id: string; recipient_email: string }>();
  return new Set(rows.results.map((row) => notificationKey(row.student_id, row.recipient_email)));
}

async function recordNotificationDelivery(env: Env, delivery: {
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
    meetingAbsenceKind,
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
