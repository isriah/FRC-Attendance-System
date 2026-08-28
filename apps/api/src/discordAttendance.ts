import { requireIsoDate } from "@frc-attendance/shared";
import type { AdminPrincipal } from "./auth";
import type { Env } from "./env";
import { buildMeetingAbsenceReport } from "./reports";

const discordBotMissingMembersKind = "discord_bot_missing_members";
const contestCustomIdPrefix = "attendance-contest:v1:";
const defaultDelayMinutes = 30;

export interface DiscordBotMissingMemberNotificationInput {
  meetingDate?: unknown;
  preview?: unknown;
  resend?: unknown;
}

export interface DiscordBotNotificationRecipient {
  memberId: string;
  firstName: string;
  lastName: string;
  discordUserId: string;
  mention: string;
  status: "would_send" | "sent" | "error" | "skipped_duplicate";
  error?: string;
}

export interface DiscordBotMissingMemberNotificationResult {
  meetingDate: string;
  title: string | null;
  notificationKind: typeof discordBotMissingMembersKind;
  providerConfigured: boolean;
  mode: "preview" | "send";
  delayMinutes: number;
  eligibleAt: string;
  sentCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  recipients: DiscordBotNotificationRecipient[];
  missingDiscord: Array<{
    memberId: string;
    firstName: string;
    lastName: string;
    status: "missing_discord";
  }>;
  warnings: string[];
}

export type AttendanceContestStatus = "pending" | "acknowledged" | "resolved" | "rejected";

export interface AttendanceContest {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  scheduledMeetingId: string;
  meetingDate: string;
  meetingTitle: string | null;
  discordUserId: string;
  sourceMessageId: string | null;
  sourceChannelId: string | null;
  reason: string | null;
  status: AttendanceContestStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByAdminEmail: string | null;
  reviewNote: string | null;
}

export interface AttendanceContestInteractionInput {
  interactionId?: string;
  discordUserId?: string;
  customId?: string;
  sourceMessageId?: string;
  sourceChannelId?: string;
}

export type AttendanceContestInteractionResult =
  | { status: "created" | "already_pending"; contest: AttendanceContest }
  | { status: "already_reviewed"; contest: AttendanceContest }
  | { status: "invalid" | "not_linked" | "not_eligible" | "already_present" };

interface MeetingRow {
  id: string;
  meeting_date: string;
  title: string | null;
  required: number;
  ends_at: string | null;
}

interface ContestRow {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  scheduled_meeting_id: string;
  meeting_date: string;
  meeting_title: string | null;
  discord_user_id: string;
  source_message_id: string | null;
  source_channel_id: string | null;
  reason: string | null;
  status: AttendanceContestStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_admin_email: string | null;
  review_note: string | null;
}

export async function sendDiscordBotMissingMemberNotifications(
  env: Env,
  input: DiscordBotMissingMemberNotificationInput,
  now = new Date()
): Promise<DiscordBotMissingMemberNotificationResult> {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const preview = input.preview === undefined ? false : requireBoolean(input.preview, "preview");
  const resend = input.resend === undefined ? false : requireBoolean(input.resend, "resend");
  const delayMinutes = discordMissingMemberDelayMinutes(env);
  const meeting = await requiredMeeting(env, meetingDate);
  const eligibleAt = meetingNotificationEligibleAt(meeting, env.TIME_ZONE, delayMinutes);
  if (now.getTime() < eligibleAt.getTime()) {
    throw Object.assign(new Error(`Discord missing-member ping is delayed until ${eligibleAt.toISOString()}`), { status: 400 });
  }

  const absenceReport = await buildMeetingAbsenceReport(env, meetingDate, now);
  const discordByMemberId = await activeDiscordUserIds(env);
  const provider = discordBotProvider(env);
  const mode = preview || !provider.configured ? "preview" : "send";
  const sentKeys = resend ? new Set<string>() : await sentNotificationKeys(env, meetingDate);
  const recipients: DiscordBotNotificationRecipient[] = [];
  const missingDiscord: DiscordBotMissingMemberNotificationResult["missingDiscord"] = [];
  const warnings: string[] = [];

  if (!provider.configured) {
    warnings.push("Discord bot delivery requires DISCORD_BOT_TOKEN and DISCORD_ATTENDANCE_CHANNEL_ID; showing preview only.");
  }
  if (resend) warnings.push("Resend enabled; previously pinged Discord members are included.");

  for (const row of absenceReport.rows) {
    const discordUserId = discordByMemberId.get(row.memberId) ?? null;
    if (!discordUserId) {
      missingDiscord.push({
        memberId: row.memberId,
        firstName: row.firstName,
        lastName: row.lastName,
        status: "missing_discord"
      });
      continue;
    }
    const duplicate = sentKeys.has(notificationKey(row.memberId, discordUserId));
    recipients.push({
      memberId: row.memberId,
      firstName: row.firstName,
      lastName: row.lastName,
      discordUserId,
      mention: `<@${discordUserId}>`,
      status: duplicate ? "skipped_duplicate" : mode === "preview" ? "would_send" : "sent"
    });
  }

  const sendableRecipients = recipients.filter((recipient) => recipient.status === "sent");
  if (mode === "send" && sendableRecipients.length > 0) {
    try {
      const delivery = await provider.send(buildDiscordBotMessage(meeting, sendableRecipients));
      await Promise.all(sendableRecipients.map((recipient) => recordNotificationDelivery(env, {
        meetingDate,
        memberId: recipient.memberId,
        discordUserId: recipient.discordUserId,
        status: "sent",
        providerMessageId: delivery.providerMessageId
      })));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await Promise.all(sendableRecipients.map((recipient) => {
        recipient.status = "error";
        recipient.error = message;
        return recordNotificationDelivery(env, {
          meetingDate,
          memberId: recipient.memberId,
          discordUserId: recipient.discordUserId,
          status: "error",
          errorMessage: message
        });
      }));
    }
  }

  return {
    meetingDate,
    title: meeting.title,
    notificationKind: discordBotMissingMembersKind,
    providerConfigured: provider.configured,
    mode,
    delayMinutes,
    eligibleAt: eligibleAt.toISOString(),
    sentCount: recipients.filter((recipient) => recipient.status === "sent").length,
    skippedDuplicateCount: recipients.filter((recipient) => recipient.status === "skipped_duplicate").length,
    errorCount: recipients.filter((recipient) => recipient.status === "error").length,
    recipients,
    missingDiscord,
    warnings
  };
}

export function attendanceContestCustomId(meetingDate: string): string {
  return `${contestCustomIdPrefix}${requireIsoDate(meetingDate, "meetingDate")}`;
}

export function parseAttendanceContestCustomId(customId: unknown): { meetingDate: string } | null {
  if (typeof customId !== "string") return null;
  const match = customId.match(/^attendance-contest:v1:(\d{4}-\d{2}-\d{2})$/);
  if (!match?.[1]) return null;
  try {
    return { meetingDate: requireIsoDate(match[1], "meetingDate") };
  } catch {
    return null;
  }
}

export async function contestAttendanceAbsence(
  env: Env,
  input: AttendanceContestInteractionInput
): Promise<AttendanceContestInteractionResult> {
  const parsed = parseAttendanceContestCustomId(input.customId);
  const interactionId = normalizeDiscordId(input.interactionId);
  const discordUserId = normalizeDiscordId(input.discordUserId);
  const sourceMessageId = normalizeDiscordId(input.sourceMessageId);
  const sourceChannelId = normalizeDiscordId(input.sourceChannelId);
  if (!parsed || !interactionId || !discordUserId || !sourceMessageId || !sourceChannelId) return { status: "invalid" };

  const member = await env.DB.prepare(`
    SELECT student_id
    FROM students
    WHERE discord_user_id = ? AND active = 1
  `).bind(discordUserId).first<{ student_id: string }>();
  if (!member) return { status: "not_linked" };

  const meeting = await env.DB.prepare(`
    SELECT id, meeting_date, title, required, ends_at
    FROM scheduled_meetings
    WHERE meeting_date = ?
  `).bind(parsed.meetingDate).first<MeetingRow>();
  if (!meeting?.required) return { status: "not_eligible" };

  const delivered = await env.DB.prepare(`
    SELECT id
    FROM notification_deliveries
    WHERE notification_kind = ?
      AND meeting_date = ?
      AND student_id = ?
      AND recipient_email = ?
      AND provider_message_id = ?
      AND status = 'sent'
    LIMIT 1
  `).bind(
    discordBotMissingMembersKind,
    parsed.meetingDate,
    member.student_id,
    discordUserId,
    sourceMessageId
  ).first<{ id: string }>();
  if (!delivered) return { status: "not_eligible" };

  const attendance = await env.DB.prepare(`
    SELECT id
    FROM attendance_sessions
    WHERE student_id = ? AND meeting_date = ?
    LIMIT 1
  `).bind(member.student_id, parsed.meetingDate).first<{ id: string }>();
  if (attendance) return { status: "already_present" };

  const createdAt = new Date().toISOString();
  const contestId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO attendance_contests (
      id,
      student_id,
      scheduled_meeting_id,
      meeting_date,
      discord_user_id,
      interaction_id,
      source_message_id,
      source_channel_id,
      reason,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(student_id, scheduled_meeting_id) DO NOTHING
  `).bind(
    contestId,
    member.student_id,
    meeting.id,
    parsed.meetingDate,
    discordUserId,
    interactionId,
    sourceMessageId,
    sourceChannelId,
    "Discord contest button",
    createdAt
  ).run();

  const contest = await getAttendanceContestForMemberMeeting(env, member.student_id, meeting.id);
  if (!contest) throw new Error("Attendance contest was not saved");
  if (contest.id === contestId) return { status: "created", contest };
  return contest.status === "pending"
    ? { status: "already_pending", contest }
    : { status: "already_reviewed", contest };
}

export async function listAttendanceContests(env: Env, statusInput?: unknown): Promise<AttendanceContest[]> {
  const status = normalizeContestListStatus(statusInput);
  const where = status === "all" ? "" : "WHERE attendance_contests.status = ?";
  const statement = env.DB.prepare(`${contestSelectSql()} ${where} ORDER BY attendance_contests.created_at DESC`);
  const rows = status === "all"
    ? await statement.all<ContestRow>()
    : await statement.bind(status).all<ContestRow>();
  return rows.results.map(contestFromRow);
}

export async function reviewAttendanceContest(
  env: Env,
  contestIdInput: string,
  input: { status?: unknown; reviewNote?: unknown },
  admin: AdminPrincipal
): Promise<AttendanceContest> {
  const contestId = requireNonEmptyString(contestIdInput, "contestId");
  const status = normalizeReviewStatus(input.status);
  const reviewNote = normalizeReviewNote(input.reviewNote);
  const existing = await getAttendanceContest(env, contestId);
  if (!existing) throw Object.assign(new Error("Attendance contest not found"), { status: 404 });

  await env.DB.prepare(`
    UPDATE attendance_contests
    SET status = ?, reviewed_at = ?, reviewed_by_admin_email = ?, review_note = ?
    WHERE id = ?
  `).bind(status, new Date().toISOString(), admin.email, reviewNote, contestId).run();

  const updated = await getAttendanceContest(env, contestId);
  if (!updated) throw new Error("Attendance contest disappeared after review");
  return updated;
}

function discordBotProvider(env: Env) {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const channelId = normalizeDiscordId(env.DISCORD_ATTENDANCE_CHANNEL_ID);
  if (!token || !channelId) {
    return {
      configured: false,
      async send(_message: ReturnType<typeof buildDiscordBotMessage>) {
        throw new Error("Discord bot delivery is not configured");
      }
    };
  }
  return {
    configured: true,
    async send(message: ReturnType<typeof buildDiscordBotMessage>) {
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bot ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(message)
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || `Discord bot API returned ${response.status}`);
      const providerMessageId = providerMessageIdFromResponse(text);
      if (!providerMessageId) throw new Error("Discord bot API response did not include a message id");
      return { providerMessageId };
    }
  };
}

function buildDiscordBotMessage(
  meeting: MeetingRow,
  recipients: DiscordBotNotificationRecipient[]
) {
  const mentions = recipients.map((recipient) => recipient.mention);
  return {
    content: [
      `Missing from ${meeting.title ?? "Required meeting"} on ${meeting.meeting_date}:`,
      mentions.join(" "),
      "",
      "If you were present, use the button below. This records a private contest for mentor review and does not change attendance."
    ].join("\n"),
    allowed_mentions: {
      parse: [] as string[],
      users: recipients.map((recipient) => recipient.discordUserId)
    },
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: "Contest absence",
        custom_id: attendanceContestCustomId(meeting.meeting_date)
      }]
    }]
  };
}

async function requiredMeeting(env: Env, meetingDate: string): Promise<MeetingRow> {
  const meeting = await env.DB.prepare(`
    SELECT id, meeting_date, title, required, ends_at
    FROM scheduled_meetings
    WHERE meeting_date = ?
  `).bind(meetingDate).first<MeetingRow>();
  if (!meeting) throw Object.assign(new Error("Scheduled meeting not found"), { status: 404 });
  if (!meeting.required) throw Object.assign(new Error("Only required meetings can send Discord bot missing-member pings"), { status: 400 });
  return meeting;
}

function meetingNotificationEligibleAt(meeting: MeetingRow, timeZone: string, delayMinutes: number): Date {
  const meetingEnd = meeting.ends_at
    ? new Date(meeting.ends_at)
    : startOfNextLocalDay(meeting.meeting_date, timeZone);
  return new Date(meetingEnd.getTime() + delayMinutes * 60_000);
}

function startOfNextLocalDay(meetingDate: string, timeZone: string): Date {
  const dateParts = meetingDate.split("-");
  const year = Number(dateParts[0]);
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const target = {
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  };
  let guess = Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const renderedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0);
    guess -= renderedAsUtc - targetAsUtc;
  }
  return new Date(guess);
}

function discordMissingMemberDelayMinutes(env: Env): number {
  const raw = env.DISCORD_MISSING_MEMBER_DELAY_MINUTES?.trim();
  if (!raw) return defaultDelayMinutes;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10_080) {
    throw new Error("DISCORD_MISSING_MEMBER_DELAY_MINUTES must be an integer from 0 to 10080");
  }
  return value;
}

async function activeDiscordUserIds(env: Env): Promise<Map<string, string>> {
  const rows = await env.DB.prepare(`
    SELECT student_id, discord_user_id
    FROM students
    WHERE active = 1 AND discord_user_id IS NOT NULL
  `).all<{ student_id: string; discord_user_id: string }>();
  return new Map(rows.results.flatMap((row) => {
    const discordUserId = normalizeDiscordId(row.discord_user_id);
    return discordUserId ? [[row.student_id, discordUserId]] : [];
  }));
}

async function sentNotificationKeys(env: Env, meetingDate: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`
    SELECT student_id, recipient_email
    FROM notification_deliveries
    WHERE notification_kind = ? AND meeting_date = ? AND status = 'sent'
  `).bind(discordBotMissingMembersKind, meetingDate).all<{ student_id: string; recipient_email: string }>();
  return new Set(rows.results.map((row) => notificationKey(row.student_id, row.recipient_email)));
}

async function recordNotificationDelivery(env: Env, delivery: {
  meetingDate: string;
  memberId: string;
  discordUserId: string;
  status: "sent" | "error";
  providerMessageId?: string;
  errorMessage?: string;
}) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO notification_deliveries (
      id, notification_kind, meeting_date, student_id, recipient_email, status,
      provider_message_id, error_message, sent_at, error_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    discordBotMissingMembersKind,
    delivery.meetingDate,
    delivery.memberId,
    delivery.discordUserId,
    delivery.status,
    delivery.providerMessageId ?? null,
    delivery.errorMessage ?? null,
    delivery.status === "sent" ? now : null,
    delivery.status === "error" ? now : null,
    now,
    now
  ).run();
}

async function getAttendanceContestForMemberMeeting(env: Env, memberId: string, scheduledMeetingId: string) {
  const row = await env.DB.prepare(`${contestSelectSql()}
    WHERE attendance_contests.student_id = ? AND attendance_contests.scheduled_meeting_id = ?
  `).bind(memberId, scheduledMeetingId).first<ContestRow>();
  return row ? contestFromRow(row) : null;
}

async function getAttendanceContest(env: Env, contestId: string) {
  const row = await env.DB.prepare(`${contestSelectSql()} WHERE attendance_contests.id = ?`)
    .bind(contestId)
    .first<ContestRow>();
  return row ? contestFromRow(row) : null;
}

function contestSelectSql() {
  return `
    SELECT
      attendance_contests.id,
      attendance_contests.student_id,
      students.first_name,
      students.last_name,
      attendance_contests.scheduled_meeting_id,
      attendance_contests.meeting_date,
      scheduled_meetings.title AS meeting_title,
      attendance_contests.discord_user_id,
      attendance_contests.source_message_id,
      attendance_contests.source_channel_id,
      attendance_contests.reason,
      attendance_contests.status,
      attendance_contests.created_at,
      attendance_contests.reviewed_at,
      attendance_contests.reviewed_by_admin_email,
      attendance_contests.review_note
    FROM attendance_contests
    INNER JOIN students ON students.student_id = attendance_contests.student_id
    LEFT JOIN scheduled_meetings ON scheduled_meetings.id = attendance_contests.scheduled_meeting_id
  `;
}

function contestFromRow(row: ContestRow): AttendanceContest {
  return {
    id: row.id,
    memberId: row.student_id,
    firstName: row.first_name,
    lastName: row.last_name,
    scheduledMeetingId: row.scheduled_meeting_id,
    meetingDate: row.meeting_date,
    meetingTitle: row.meeting_title,
    discordUserId: row.discord_user_id,
    sourceMessageId: row.source_message_id,
    sourceChannelId: row.source_channel_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedByAdminEmail: row.reviewed_by_admin_email,
    reviewNote: row.review_note
  };
}

function normalizeContestListStatus(value: unknown): AttendanceContestStatus | "all" {
  if (value === undefined || value === null || value === "" || value === "all") return "all";
  if (value === "pending" || value === "acknowledged" || value === "resolved" || value === "rejected") return value;
  throw Object.assign(new Error("Invalid attendance contest status"), { status: 400 });
}

function normalizeReviewStatus(value: unknown): Exclude<AttendanceContestStatus, "pending"> {
  if (value === "acknowledged" || value === "resolved" || value === "rejected") return value;
  throw Object.assign(new Error("Contest status must be acknowledged, resolved, or rejected"), { status: 400 });
}

function normalizeReviewNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw Object.assign(new Error("reviewNote must be a string"), { status: 400 });
  const note = value.trim();
  if (note.length > 1000) throw Object.assign(new Error("reviewNote must be 1000 characters or fewer"), { status: 400 });
  return note || null;
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

function normalizeDiscordId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^\d{5,25}$/.test(normalized) ? normalized : null;
}

function notificationKey(memberId: string, discordUserId: string) {
  return `${memberId}:${discordUserId}`;
}

function providerMessageIdFromResponse(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined;
  } catch {
    return undefined;
  }
}
