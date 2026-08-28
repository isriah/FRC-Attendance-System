import type { Env } from "./env";
import { contestAttendanceAbsence, type AttendanceContestInteractionResult } from "./discordAttendance";

const interactionPing = 1;
const interactionApplicationCommand = 2;
const interactionMessageComponent = 3;
const responsePong = 1;
const responseChannelMessage = 4;
const ephemeralFlag = 64;

interface DiscordInteraction {
  id?: string;
  type?: number;
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{ name?: string; type?: number; value?: unknown }>;
  };
  member?: { user?: { id?: string } };
  user?: { id?: string };
  message?: { id?: string };
  channel_id?: string;
}

interface LinkedMemberRow {
  student_id: string;
  first_name: string;
  last_name: string;
  discord_user_id: string | null;
  active: number;
}

type LinkResult =
  | { status: "linked" | "already_linked"; member: LinkedMemberRow }
  | { status: "not_found" | "inactive" | "member_conflict"; member?: LinkedMemberRow }
  | { status: "discord_conflict"; memberId: string };

export async function handleDiscordInteraction(request: Request, env: Env): Promise<Response> {
  const publicKey = decodeHex(env.DISCORD_PUBLIC_KEY, 32);
  if (!publicKey) return discordJson({ error: "Discord interactions are not configured" }, 503);

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();
  if (!signature || !timestamp || !await verifyDiscordRequestSignature(publicKey, signature, timestamp, rawBody)) {
    return discordJson({ error: "Invalid request signature" }, 401);
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return ephemeral("The interaction payload was not valid JSON.");
  }

  if (interaction.type === interactionPing) return discordJson({ type: responsePong });
  if (interaction.type === interactionMessageComponent) {
    return handleAttendanceContestButton(env, interaction);
  }
  if (interaction.type !== interactionApplicationCommand) {
    return ephemeral("This Discord interaction is not supported yet.");
  }
  if (interaction.data?.name !== "link-attendance") {
    return ephemeral("Unknown attendance command.");
  }

  const memberId = stringOption(interaction, "member_id") ?? stringOption(interaction, "student_id");
  const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!memberId) return ephemeral("Provide your attendance member ID with the `member_id` option.");
  if (!discordUserId || !/^\d{5,25}$/.test(discordUserId)) {
    return ephemeral("Discord did not provide a valid user ID for this interaction.");
  }

  try {
    return ephemeral(linkResultMessage(await linkDiscordUser(env, memberId, discordUserId), memberId));
  } catch (error) {
    console.error("Discord attendance link failed", error);
    return ephemeral("Attendance linking is temporarily unavailable. Please try again or ask a mentor for help.");
  }
}

async function handleAttendanceContestButton(env: Env, interaction: DiscordInteraction): Promise<Response> {
  const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
  try {
    const result = await contestAttendanceAbsence(env, {
      interactionId: interaction.id,
      discordUserId,
      customId: interaction.data?.custom_id,
      sourceMessageId: interaction.message?.id,
      sourceChannelId: interaction.channel_id
    });
    return ephemeral(attendanceContestResultMessage(result));
  } catch (error) {
    console.error("Discord attendance contest failed", error);
    return ephemeral("Your attendance contest could not be recorded right now. Please try again or ask a mentor for help.");
  }
}

function attendanceContestResultMessage(result: AttendanceContestInteractionResult): string {
  switch (result.status) {
    case "created":
      return `Your attendance contest for ${result.contest.meetingDate} was recorded for mentor review. Your attendance has not been changed.`;
    case "already_pending":
      return `You already have a pending attendance contest for ${result.contest.meetingDate}. A mentor can review it in the dashboard.`;
    case "already_reviewed":
      return `Your attendance contest for ${result.contest.meetingDate} was already reviewed with status ${result.contest.status}. Ask a mentor if you still need help.`;
    case "not_linked":
      return "Your Discord account is not linked to an active attendance member. Use `/link-attendance` or ask a mentor for help.";
    case "already_present":
      return "Attendance already shows you as present for this meeting, so no contest was created.";
    case "not_eligible":
      return "This contest button is not valid for your account or this meeting. Ask a mentor if you believe your attendance is wrong.";
    case "invalid":
      return "This attendance contest button is invalid or expired. Ask a mentor for help.";
  }
}

export async function verifyDiscordRequestSignature(
  publicKey: Uint8Array,
  signatureHex: string,
  timestamp: string,
  rawBody: string
): Promise<boolean> {
  const signature = decodeHex(signatureHex, 64);
  if (!signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey("raw", toArrayBuffer(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const message = new TextEncoder().encode(timestamp + rawBody);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, toArrayBuffer(signature), toArrayBuffer(message));
  } catch {
    return false;
  }
}

async function linkDiscordUser(env: Env, memberIdInput: string, discordUserId: string): Promise<LinkResult> {
  const memberId = memberIdInput.trim();
  const member = await env.DB.prepare(`
    SELECT student_id, first_name, last_name, discord_user_id, active
    FROM students
    WHERE student_id = ?
  `).bind(memberId).first<LinkedMemberRow>();

  if (!member) return { status: "not_found" };
  if (!member.active) return { status: "inactive", member };
  if (member.discord_user_id === discordUserId) return { status: "already_linked", member };
  if (member.discord_user_id) return { status: "member_conflict", member };

  const existing = await env.DB.prepare(
    "SELECT student_id FROM students WHERE discord_user_id = ? AND student_id <> ?"
  ).bind(discordUserId, memberId).first<{ student_id: string }>();
  if (existing) return { status: "discord_conflict", memberId: existing.student_id };

  const update = await env.DB.prepare(
    "UPDATE students SET discord_user_id = ? WHERE student_id = ? AND discord_user_id IS NULL AND active = 1"
  ).bind(discordUserId, memberId).run();
  const changes = update.meta?.changes ?? (update as D1Result & { changes?: number }).changes;
  if (changes === 0) {
    return await currentLinkResult(env, memberId, discordUserId);
  }
  return { status: "linked", member: { ...member, discord_user_id: discordUserId } };
}

async function currentLinkResult(env: Env, memberId: string, discordUserId: string): Promise<LinkResult> {
  const member = await env.DB.prepare(`
    SELECT student_id, first_name, last_name, discord_user_id, active
    FROM students
    WHERE student_id = ?
  `).bind(memberId).first<LinkedMemberRow>();

  if (!member) return { status: "not_found" };
  if (!member.active) return { status: "inactive", member };
  if (member.discord_user_id === discordUserId) return { status: "already_linked", member };
  if (member.discord_user_id) return { status: "member_conflict", member };

  const existing = await env.DB.prepare(
    "SELECT student_id FROM students WHERE discord_user_id = ? AND student_id <> ?"
  ).bind(discordUserId, memberId).first<{ student_id: string }>();
  if (existing) return { status: "discord_conflict", memberId: existing.student_id };

  throw new Error("Discord attendance link update did not change the expected member");
}

function linkResultMessage(result: LinkResult, requestedMemberId: string): string {
  switch (result.status) {
    case "linked":
      return `Linked your Discord account to ${result.member.first_name} ${result.member.last_name} (member ID ${result.member.student_id}).`;
    case "already_linked":
      return `Your Discord account is already linked to member ID ${result.member.student_id}.`;
    case "not_found":
      return `No attendance member was found for ID ${requestedMemberId.trim()}. Check the ID or ask a mentor for help.`;
    case "inactive":
      return `Member ID ${result.member?.student_id ?? requestedMemberId.trim()} is inactive. Ask a mentor to reactivate it before linking.`;
    case "member_conflict":
      return `Member ID ${result.member?.student_id ?? requestedMemberId.trim()} is already linked to a different Discord account. Ask a mentor to review the link.`;
    case "discord_conflict":
      return `Your Discord account is already linked to member ID ${result.memberId}. Ask a mentor to review the link if this is incorrect.`;
  }
}

function stringOption(interaction: DiscordInteraction, name: string): string | null {
  const option = interaction.data?.options?.find((candidate) => candidate.name === name);
  return option?.type === 3 && typeof option.value === "string" && option.value.trim() ? option.value : null;
}

function ephemeral(content: string): Response {
  return discordJson({
    type: responseChannelMessage,
    data: { content, flags: ephemeralFlag }
  });
}

function discordJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function decodeHex(value: string | undefined, expectedBytes: number): Uint8Array | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.length !== expectedBytes * 2 || !/^[0-9a-f]+$/.test(normalized)) return null;
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
