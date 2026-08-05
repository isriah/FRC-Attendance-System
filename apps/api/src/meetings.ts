import { meetingDateForTimestamp, requireIsoDate, requireIsoTimestamp, requireNonEmptyString, type ScheduledMeeting } from "@frc-attendance/shared";
import type { Env } from "./env";

export interface ScheduledMeetingInput {
  meetingDate?: unknown;
  title?: unknown;
  required?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  notes?: unknown;
}

export async function listScheduledMeetings(env: Env): Promise<ScheduledMeeting[]> {
  const rows = await env.DB.prepare(`
    SELECT id, meeting_date, title, required, starts_at, ends_at, notes, created_at, updated_at
    FROM scheduled_meetings
    ORDER BY meeting_date, starts_at
  `).all<ScheduledMeetingRow>();
  return rows.results.map(fromRow);
}

export async function createScheduledMeeting(env: Env, input: ScheduledMeetingInput): Promise<ScheduledMeeting> {
  const normalized = normalizeMeetingInput(input, env.TIME_ZONE);
  const now = new Date().toISOString();
  const meeting: ScheduledMeeting = {
    id: crypto.randomUUID(),
    meetingDate: normalized.meetingDate,
    title: normalized.title,
    required: normalized.required,
    startsAt: normalized.startsAt,
    endsAt: normalized.endsAt,
    notes: normalized.notes,
    createdAt: now,
    updatedAt: now
  };

  try {
    await env.DB.prepare(`
      INSERT INTO scheduled_meetings (id, meeting_date, title, required, starts_at, ends_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      meeting.id,
      meeting.meetingDate,
      meeting.title,
      meeting.required ? 1 : 0,
      meeting.startsAt ?? null,
      meeting.endsAt ?? null,
      meeting.notes ?? null,
      meeting.createdAt,
      meeting.updatedAt
    ).run();
  } catch (error) {
    throwUniqueMeetingDateError(error, meeting.meetingDate);
  }

  return meeting;
}

export async function updateScheduledMeeting(env: Env, meetingId: string, input: ScheduledMeetingInput): Promise<ScheduledMeeting> {
  const existing = await getScheduledMeetingRow(env, meetingId);
  if (!existing) throw Object.assign(new Error("Scheduled meeting not found"), { status: 404 });

  const normalized = normalizeMeetingInput(input, env.TIME_ZONE);
  const updatedAt = new Date().toISOString();
  try {
    await env.DB.prepare(`
      UPDATE scheduled_meetings
      SET meeting_date = ?, title = ?, required = ?, starts_at = ?, ends_at = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      normalized.meetingDate,
      normalized.title,
      normalized.required ? 1 : 0,
      normalized.startsAt ?? null,
      normalized.endsAt ?? null,
      normalized.notes ?? null,
      updatedAt,
      meetingId
    ).run();
  } catch (error) {
    throwUniqueMeetingDateError(error, normalized.meetingDate);
  }

  const updated = await getScheduledMeetingRow(env, meetingId);
  if (!updated) throw Object.assign(new Error("Scheduled meeting not found"), { status: 404 });
  return fromRow(updated);
}

export async function deleteScheduledMeeting(env: Env, meetingId: string): Promise<void> {
  const existing = await getScheduledMeetingRow(env, meetingId);
  if (!existing) throw Object.assign(new Error("Scheduled meeting not found"), { status: 404 });
  await env.DB.prepare("DELETE FROM scheduled_meetings WHERE id = ?").bind(meetingId).run();
}

function normalizeMeetingInput(input: ScheduledMeetingInput, timeZone: string): Omit<ScheduledMeeting, "id" | "createdAt" | "updatedAt"> {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const title = requireNonEmptyString(input.title, "title");
  const required = input.required === undefined ? true : requireBoolean(input.required, "required");
  const startsAt = optionalIsoTimestamp(input.startsAt, "startsAt");
  const endsAt = optionalIsoTimestamp(input.endsAt, "endsAt");
  requireTimestampOnMeetingDate(startsAt, meetingDate, timeZone, "startsAt");
  requireTimestampOnMeetingDate(endsAt, meetingDate, timeZone, "endsAt");
  if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    throw Object.assign(new Error("endsAt must be after startsAt"), { status: 400 });
  }

  return {
    meetingDate,
    title,
    required,
    startsAt,
    endsAt,
    notes: optionalTrimmedString(input.notes)
  };
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw Object.assign(new Error(`${fieldName} must be a boolean`), { status: 400 });
  }
  return value;
}

function optionalIsoTimestamp(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireIsoTimestamp(value, fieldName);
}

function requireTimestampOnMeetingDate(value: string | undefined, meetingDate: string, timeZone: string, fieldName: string) {
  if (!value) return;
  if (meetingDateForTimestamp(value, timeZone) !== meetingDate) {
    throw Object.assign(new Error(`${fieldName} must be on meetingDate`), { status: 400 });
  }
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw Object.assign(new Error("notes must be a string"), { status: 400 });
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function getScheduledMeetingRow(env: Env, meetingId: string) {
  return env.DB.prepare(`
    SELECT id, meeting_date, title, required, starts_at, ends_at, notes, created_at, updated_at
    FROM scheduled_meetings
    WHERE id = ?
  `).bind(requireNonEmptyString(meetingId, "meetingId")).first<ScheduledMeetingRow>();
}

function throwUniqueMeetingDateError(error: unknown, meetingDate: string): never {
  if (error instanceof Error && /unique|constraint/i.test(error.message)) {
    throw Object.assign(new Error(`Scheduled meeting already exists for ${meetingDate}`), { status: 409 });
  }
  throw error;
}

function fromRow(row: ScheduledMeetingRow): ScheduledMeeting {
  return {
    id: row.id,
    meetingDate: row.meeting_date,
    title: row.title,
    required: Boolean(row.required),
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

interface ScheduledMeetingRow {
  id: string;
  meeting_date: string;
  title: string;
  required: number;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
