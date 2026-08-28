import { meetingDateForTimestamp, requireNonEmptyString } from "@frc-attendance/shared";
import type { Env } from "./env";

const defaultLocation = "Central High School";
const discordApiBase = "https://discord.com/api/v10";
const guildOnlyPrivacyLevel = 2;
const externalEntityType = 3;

export interface DiscordScheduledEventSyncInput {
  meetingIds?: unknown;
  location?: unknown;
}

export interface DiscordScheduledEventSyncResult {
  notificationKind: "discord_scheduled_event_sync";
  providerConfigured: boolean;
  guildId: string | null;
  location: string;
  syncedCount: number;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  meetings: DiscordScheduledEventMeetingResult[];
  warnings: string[];
}

export interface DiscordScheduledEventMeetingResult {
  meetingId: string;
  meetingDate?: string;
  title?: string;
  discordEventId?: string;
  status: "created" | "updated" | "error";
  error?: string;
}

interface MeetingRow {
  id: string;
  meeting_date: string;
  title: string;
  required: number;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
}

interface MappingRow {
  scheduled_meeting_id: string;
  guild_id: string;
  discord_event_id: string;
  location: string;
  status: string;
  attempts: number;
  last_synced_at: string | null;
  last_error: string | null;
}

interface DiscordScheduledEventPayload {
  channel_id: null;
  name: string;
  privacy_level: typeof guildOnlyPrivacyLevel;
  scheduled_start_time: string;
  scheduled_end_time: string;
  description?: string;
  entity_type: typeof externalEntityType;
  entity_metadata: { location: string };
}

interface DiscordScheduledEventResponse {
  id?: unknown;
  guild_id?: unknown;
}

export async function syncDiscordScheduledEvents(
  env: Env,
  input: DiscordScheduledEventSyncInput
): Promise<DiscordScheduledEventSyncResult> {
  const meetingIds = requireMeetingIds(input.meetingIds);
  const location = normalizeLocation(input.location);
  const provider = await discordScheduledEventProvider(env);
  const warnings: string[] = [];
  if (!provider.configured) warnings.push(provider.error);

  const meetings = await meetingsById(env, meetingIds);
  const mappings = await mappingsByMeetingId(env, meetingIds);
  const results: DiscordScheduledEventMeetingResult[] = [];
  const checkedAt = new Date().toISOString();

  for (const meetingId of meetingIds) {
    const meeting = meetings.get(meetingId);
    if (!meeting) {
      results.push({ meetingId, status: "error", error: "Scheduled meeting not found" });
      continue;
    }

    const baseResult = {
      meetingId,
      meetingDate: meeting.meeting_date,
      title: meeting.title
    };
    let payload: DiscordScheduledEventPayload;
    try {
      payload = buildDiscordScheduledEventPayload(meeting, env.TIME_ZONE, location);
    } catch (error) {
      const message = errorMessage(error);
      await markMappingError(env, meetingId, mappings.get(meetingId), location, message, checkedAt);
      results.push({ ...baseResult, status: "error", error: message });
      continue;
    }

    if (!provider.configured) {
      const message = provider.error;
      await markMappingError(env, meetingId, mappings.get(meetingId), location, message, checkedAt);
      results.push({ ...baseResult, status: "error", error: message });
      continue;
    }

    const mapping = mappings.get(meetingId);
    try {
      if (mapping?.discord_event_id && mapping.guild_id === provider.guildId) {
        const updated = await provider.update(mapping.discord_event_id, payload);
        const eventId = normalizeDiscordId(updated.id) ?? mapping.discord_event_id;
        await upsertMapping(env, {
          meetingId,
          guildId: provider.guildId,
          eventId,
          location,
          status: "synced",
          syncedAt: checkedAt
        });
        results.push({ ...baseResult, discordEventId: eventId, status: "updated" });
      } else {
        const created = await provider.create(payload);
        const eventId = normalizeDiscordId(created.id);
        if (!eventId) throw new Error("Discord scheduled-event response did not include an event id");
        await upsertMapping(env, {
          meetingId,
          guildId: provider.guildId,
          eventId,
          location,
          status: "synced",
          syncedAt: checkedAt
        });
        results.push({ ...baseResult, discordEventId: eventId, status: "created" });
      }
    } catch (error) {
      const message = errorMessage(error);
      await markMappingError(env, meetingId, mapping, location, message, checkedAt);
      results.push({
        ...baseResult,
        discordEventId: mapping?.discord_event_id,
        status: "error",
        error: message
      });
    }
  }

  return {
    notificationKind: "discord_scheduled_event_sync",
    providerConfigured: provider.configured,
    guildId: provider.configured ? provider.guildId : null,
    location,
    syncedCount: results.filter((result) => result.status === "created" || result.status === "updated").length,
    createdCount: results.filter((result) => result.status === "created").length,
    updatedCount: results.filter((result) => result.status === "updated").length,
    errorCount: results.filter((result) => result.status === "error").length,
    meetings: results,
    warnings
  };
}

export function buildDiscordScheduledEventPayload(
  meeting: MeetingRow,
  timeZone: string,
  location = defaultLocation
): DiscordScheduledEventPayload {
  const startsAt = meetingTimestamp(meeting.starts_at, meeting.meeting_date, timeZone, "startsAt");
  const endsAt = meetingTimestamp(meeting.ends_at, meeting.meeting_date, timeZone, "endsAt");
  if (endsAt.getTime() <= startsAt.getTime()) throw new Error("Meeting end time must be after the start time");

  const description = [
    meeting.notes?.trim() ?? "",
    meeting.required ? "Attendance: required" : "Attendance: optional"
  ].filter(Boolean).join("\n\n").slice(0, 1000);

  return {
    channel_id: null,
    name: meeting.title.trim().slice(0, 100),
    privacy_level: guildOnlyPrivacyLevel,
    scheduled_start_time: startsAt.toISOString(),
    scheduled_end_time: endsAt.toISOString(),
    ...(description ? { description } : {}),
    entity_type: externalEntityType,
    entity_metadata: { location: normalizeLocation(location) }
  };
}

async function discordScheduledEventProvider(env: Env) {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    return {
      configured: false as const,
      guildId: null,
      error: "Discord scheduled-event sync requires DISCORD_BOT_TOKEN"
    };
  }

  try {
    const guildId = await resolveDiscordGuildId(env, token);
    if (!guildId) {
      return {
        configured: false as const,
        guildId: null,
        error: "Discord scheduled-event sync requires DISCORD_GUILD_ID or a bot-accessible DISCORD_ATTENDANCE_CHANNEL_ID"
      };
    }
    return {
      configured: true as const,
      guildId,
      async create(payload: DiscordScheduledEventPayload) {
        return discordJson<DiscordScheduledEventResponse>(
          token,
          `${discordApiBase}/guilds/${guildId}/scheduled-events`,
          "POST",
          payload
        );
      },
      async update(eventId: string, payload: DiscordScheduledEventPayload) {
        return discordJson<DiscordScheduledEventResponse>(
          token,
          `${discordApiBase}/guilds/${guildId}/scheduled-events/${eventId}`,
          "PATCH",
          payload
        );
      }
    };
  } catch (error) {
    return {
      configured: false as const,
      guildId: null,
      error: errorMessage(error)
    };
  }
}

async function resolveDiscordGuildId(env: Env, token: string): Promise<string | null> {
  const configuredGuildId = normalizeDiscordId(env.DISCORD_GUILD_ID);
  if (configuredGuildId) return configuredGuildId;
  const channelId = normalizeDiscordId(env.DISCORD_ATTENDANCE_CHANNEL_ID);
  if (!channelId) return null;
  const channel = await discordJson<{ guild_id?: unknown }>(
    token,
    `${discordApiBase}/channels/${channelId}`,
    "GET"
  );
  return normalizeDiscordId(channel.guild_id);
}

async function discordJson<T>(token: string, url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Discord bot API returned ${response.status}`);
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function meetingTimestamp(value: string | null, meetingDate: string, timeZone: string, fieldName: string): Date {
  if (!value?.trim()) throw new Error(`${fieldName} is required for Discord scheduled events`);
  const trimmed = value.trim();
  const date = /^\d{2}:\d{2}$/.test(trimmed)
    ? localDateAndTime(meetingDate, trimmed, timeZone)
    : new Date(trimmed);
  if (!Number.isFinite(date.getTime())) throw new Error(`${fieldName} must be a valid timestamp`);
  try {
    if (meetingDateForTimestamp(date.toISOString(), timeZone) !== meetingDate) {
      throw new Error(`${fieldName} must be on meetingDate`);
    }
  } catch {
    throw new Error(`${fieldName} must be on meetingDate`);
  }
  return date;
}

function localDateAndTime(meetingDate: string, time: string, timeZone: string): Date {
  const [yearText, monthText, dayText] = meetingDate.split("-");
  const [hourText, minuteText] = time.split(":");
  const target = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText)
  };
  let guess = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0);
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
    const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0);
    guess -= renderedAsUtc - targetAsUtc;
  }
  return new Date(guess);
}

async function meetingsById(env: Env, meetingIds: string[]): Promise<Map<string, MeetingRow>> {
  const rows: MeetingRow[] = [];
  for (const meetingId of meetingIds) {
    const row = await env.DB.prepare(`
      SELECT id, meeting_date, title, required, starts_at, ends_at, notes
      FROM scheduled_meetings
      WHERE id = ?
    `).bind(meetingId).first<MeetingRow>();
    if (row) rows.push(row);
  }
  return new Map(rows.map((row) => [row.id, row]));
}

async function mappingsByMeetingId(env: Env, meetingIds: string[]): Promise<Map<string, MappingRow>> {
  const rows: MappingRow[] = [];
  for (const meetingId of meetingIds) {
    const row = await env.DB.prepare(`
      SELECT scheduled_meeting_id, guild_id, discord_event_id, location, status, attempts, last_synced_at, last_error
      FROM discord_scheduled_event_mappings
      WHERE scheduled_meeting_id = ?
    `).bind(meetingId).first<MappingRow>();
    if (row) rows.push(row);
  }
  return new Map(rows.map((row) => [row.scheduled_meeting_id, row]));
}

async function upsertMapping(env: Env, input: {
  meetingId: string;
  guildId: string;
  eventId: string;
  location: string;
  status: "synced";
  syncedAt: string;
}) {
  await env.DB.prepare(`
    INSERT INTO discord_scheduled_event_mappings (
      scheduled_meeting_id, guild_id, discord_event_id, location, status, attempts,
      last_synced_at, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
    ON CONFLICT(scheduled_meeting_id) DO UPDATE SET
      guild_id = excluded.guild_id,
      discord_event_id = excluded.discord_event_id,
      location = excluded.location,
      status = excluded.status,
      attempts = discord_scheduled_event_mappings.attempts + 1,
      last_synced_at = excluded.last_synced_at,
      last_error = NULL,
      updated_at = excluded.updated_at
  `).bind(
    input.meetingId,
    input.guildId,
    input.eventId,
    input.location,
    input.status,
    input.syncedAt,
    input.syncedAt,
    input.syncedAt
  ).run();
}

async function markMappingError(
  env: Env,
  meetingId: string,
  mapping: MappingRow | undefined,
  location: string,
  message: string,
  now: string
) {
  if (mapping) {
    await env.DB.prepare(`
      UPDATE discord_scheduled_event_mappings
      SET location = ?,
        status = 'error',
        attempts = attempts + 1,
        last_error = ?,
        updated_at = ?
      WHERE scheduled_meeting_id = ?
    `).bind(location, message.slice(0, 1000), now, meetingId).run();
  }
}

function requireMeetingIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw Object.assign(new Error("meetingIds must be an array"), { status: 400 });
  const meetingIds = value.map((meetingId) => requireNonEmptyString(meetingId, "meetingId"));
  if (meetingIds.length === 0) throw Object.assign(new Error("Select at least one scheduled meeting"), { status: 400 });
  return [...new Set(meetingIds)];
}

function normalizeLocation(value: unknown): string {
  if (value === undefined || value === null || value === "") return defaultLocation;
  if (typeof value !== "string") throw Object.assign(new Error("location must be a string"), { status: 400 });
  const location = value.trim();
  if (!location) return defaultLocation;
  if (location.length > 100) throw Object.assign(new Error("location must be 100 characters or fewer"), { status: 400 });
  return location;
}

function normalizeDiscordId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^\d{5,25}$/.test(normalized) ? normalized : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
