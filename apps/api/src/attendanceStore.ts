import { DEFAULT_DUPLICATE_WINDOW_MS, deriveAttendanceSessions, isDuplicateScan, meetingDateForTimestamp, requireIsoDate } from "@frc-attendance/shared";
import type { KioskScanAcknowledgement, KioskSyncEventInput, KioskSyncResult, ScanEvent, ScanEventStatus } from "@frc-attendance/shared";
import type { Env } from "./env";
import { buildMemberAttendanceReport } from "./reports";

const eventId = (kioskId: string, localEventId: string) => `${kioskId}:${localEventId}`;

export async function syncKioskEvents(env: Env, kioskId: string, events: KioskSyncEventInput[]): Promise<KioskSyncResult> {
  const accepted: ScanEvent[] = [];
  const duplicates: ScanEvent[] = [];
  const rejected: KioskSyncResult["rejected"] = [];
  const acknowledgementInputs: AcknowledgementInput[] = [];
  const duplicateWindow = Number(env.DUPLICATE_WINDOW_SECONDS || "90") * 1000 || DEFAULT_DUPLICATE_WINDOW_MS;
  const now = new Date().toISOString();

  for (const rawInput of events) {
    const input = normalizeKioskSyncEvent(rawInput);
    const existing = await env.DB.prepare(
      "SELECT id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status FROM scan_events WHERE kiosk_id = ? AND local_event_id = ?"
    ).bind(kioskId, input.localEventId).first<{
      id: string;
      kiosk_id: string;
      local_event_id: string;
      student_id: string;
      occurred_at: string;
      synced_at: string;
      source: "fingerprint";
      status: "accepted" | "duplicate" | "rejected";
    }>();

    if (existing) {
      const event = rowToScanEvent(existing);
      if (event.status === "duplicate") duplicates.push(event);
      else if (event.status === "accepted") accepted.push(event);
      else rejected.push({ ...input, reason: "previously rejected" });
      acknowledgementInputs.push({
        input,
        status: event.status,
        reason: event.status === "rejected" ? "previously rejected" : undefined,
        action: event.status === "accepted" ? await actionForAcceptedScan(env, kioskId, input) : undefined
      });
      continue;
    }

    const student = await env.DB.prepare("SELECT active FROM students WHERE student_id = ?").bind(input.memberId).first<{ active: number }>();
    if (!student || !student.active) {
      const reason = "member is not active in roster";
      rejected.push({ ...input, reason });
      await insertScanEvent(env, kioskId, input, now, "rejected", reason);
      acknowledgementInputs.push({ input, status: "rejected", reason });
      continue;
    }

    const occurredAtMs = new Date(input.occurredAt).getTime();
    const duplicateWindowMatches = Number.isNaN(occurredAtMs)
      ? null
      : await env.DB.prepare(
        "SELECT id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status FROM scan_events WHERE student_id = ? AND status = 'accepted' AND occurred_at BETWEEN ? AND ? ORDER BY occurred_at DESC"
      ).bind(
        input.memberId,
        new Date(occurredAtMs - duplicateWindow).toISOString(),
        new Date(occurredAtMs + duplicateWindow).toISOString()
      ).all<Parameters<typeof rowToScanEvent>[0]>();
    const inputMeetingDate = meetingDateForTimestamp(input.occurredAt, env.TIME_ZONE);
    const duplicateWindowMatch = duplicateWindowMatches?.results
      .map(rowToScanEvent)
      .find((event) => meetingDateForTimestamp(event.occurredAt, env.TIME_ZONE) === inputMeetingDate);

    if (isDuplicateScan(duplicateWindowMatch, input, duplicateWindow)) {
      const event = await insertScanEvent(env, kioskId, input, now, "duplicate", "duplicate scan window");
      duplicates.push(event);
      acknowledgementInputs.push({ input, status: "duplicate", reason: "duplicate scan window" });
      continue;
    }

    const event = await insertScanEvent(env, kioskId, input, now, "accepted");
    accepted.push(event);
    acknowledgementInputs.push({ input, status: "accepted", action: await actionForAcceptedScan(env, kioskId, input) });
  }

  if (accepted.length > 0) await rebuildAttendanceSessions(env);
  return {
    accepted,
    duplicates,
    rejected,
    acknowledgements: await Promise.all(acknowledgementInputs.map((acknowledgement) => buildAcknowledgement(env, acknowledgement)))
  };
}

export async function addManualEvent(env: Env, input: { memberId: string; occurredAt: string; action: "check_in" | "check_out"; reason: string; adminEmail: string }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO manual_events (id, student_id, occurred_at, action, reason, admin_email) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, input.memberId, input.occurredAt, input.action, input.reason, input.adminEmail).run();
  await rebuildAttendanceSessions(env);
  return { id, ...input };
}

export async function removeMemberFromMeeting(env: Env, input: { memberId: string; meetingDate?: unknown; reason: string; adminEmail: string }) {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const member = await env.DB.prepare(
    "SELECT first_name, last_name FROM students WHERE student_id = ?"
  ).bind(input.memberId).first<{ first_name: string; last_name: string }>();
  if (!member) throw Object.assign(new Error("Member not found"), { status: 404 });

  const sessions = await env.DB.prepare(
    "SELECT source_event_ids FROM attendance_sessions WHERE student_id = ? AND meeting_date = ? AND check_out_at IS NOT NULL"
  ).bind(input.memberId, meetingDate).all<{ source_event_ids: string }>();
  if (sessions.results.length === 0) throw Object.assign(new Error("Member is not present for this meeting"), { status: 409 });

  const existing = await env.DB.prepare(
    "SELECT id FROM attendance_exclusions WHERE student_id = ? AND meeting_date = ? AND superseded_at IS NULL"
  ).bind(input.memberId, meetingDate).first<{ id: string }>();
  if (existing) throw Object.assign(new Error("Member has already been removed from this meeting"), { status: 409 });

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO attendance_exclusions (id, student_id, meeting_date, reason, admin_email) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, input.memberId, meetingDate, input.reason, input.adminEmail),
    env.DB.prepare("DELETE FROM attendance_sessions WHERE student_id = ? AND meeting_date = ?").bind(input.memberId, meetingDate)
  ]);

  return {
    id,
    memberId: input.memberId,
    firstName: member.first_name,
    lastName: member.last_name,
    meetingDate,
    reason: input.reason,
    adminEmail: input.adminEmail,
    preservedSourceEventIds: [...new Set(sessions.results.flatMap((session) => JSON.parse(session.source_event_ids) as string[]))]
  };
}

export async function excuseMemberFromMeeting(env: Env, input: { memberId: string; meetingDate?: unknown; reason?: unknown; adminEmail: string }) {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const [member, meeting, present, existing] = await Promise.all([
    env.DB.prepare("SELECT first_name, last_name FROM students WHERE student_id = ?").bind(input.memberId).first<{ first_name: string; last_name: string }>(),
    env.DB.prepare("SELECT title FROM scheduled_meetings WHERE meeting_date = ?").bind(meetingDate).first<{ title: string }>(),
    env.DB.prepare("SELECT id FROM attendance_sessions WHERE student_id = ? AND meeting_date = ? AND check_out_at IS NOT NULL").bind(input.memberId, meetingDate).first<{ id: string }>(),
    env.DB.prepare("SELECT id FROM attendance_excuses WHERE student_id = ? AND meeting_date = ? AND removed_at IS NULL").bind(input.memberId, meetingDate).first<{ id: string }>()
  ]);
  if (!member) throw Object.assign(new Error("Member not found"), { status: 404 });
  if (!meeting) throw Object.assign(new Error("Excuses can only be added to scheduled meetings"), { status: 400 });
  if (present) throw Object.assign(new Error("A present member cannot be excused for this meeting"), { status: 409 });
  if (existing) throw Object.assign(new Error("Member is already excused for this meeting"), { status: 409 });
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare("INSERT INTO attendance_excuses (id, student_id, meeting_date, reason, created_by_email, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, input.memberId, meetingDate, reason || null, input.adminEmail, createdAt).run();
  return { id, memberId: input.memberId, firstName: member.first_name, lastName: member.last_name, meetingDate, meetingTitle: meeting.title, reason: reason || null, createdByEmail: input.adminEmail, createdAt };
}

export async function removeMemberMeetingExcuse(env: Env, input: { memberId: string; meetingDate?: unknown; adminEmail: string }) {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const excuse = await env.DB.prepare("SELECT id FROM attendance_excuses WHERE student_id = ? AND meeting_date = ? AND removed_at IS NULL")
    .bind(input.memberId, meetingDate).first<{ id: string }>();
  if (!excuse) throw Object.assign(new Error("No active excuse exists for this member and meeting"), { status: 404 });
  const removedAt = new Date().toISOString();
  await env.DB.prepare("UPDATE attendance_excuses SET removed_by_email = ?, removed_at = ? WHERE id = ?")
    .bind(input.adminEmail, removedAt, excuse.id).run();
  return { id: excuse.id, memberId: input.memberId, meetingDate, removedByEmail: input.adminEmail, removedAt };
}

export async function clearMemberAttendanceSourceData(env: Env, input: { memberId: string; meetingDate?: unknown; confirmation?: unknown; reason: string; adminEmail: string }) {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const expectedConfirmation = clearMemberAttendanceConfirmation(input.memberId, meetingDate);
  if (input.confirmation !== expectedConfirmation) {
    throw Object.assign(new Error(`Type ${expectedConfirmation} to clear attendance source data for member ${input.memberId} on ${meetingDate}`), { status: 400 });
  }

  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw Object.assign(new Error("A debugging note of at least 10 characters is required to clear attendance source data"), { status: 400 });
  }

  const [member, meeting] = await Promise.all([
    env.DB.prepare("SELECT first_name, last_name FROM students WHERE student_id = ?").bind(input.memberId).first<{ first_name: string; last_name: string }>(),
    env.DB.prepare("SELECT id, title FROM scheduled_meetings WHERE meeting_date = ?").bind(meetingDate).first<{ id: string; title: string }>()
  ]);
  if (!member) throw Object.assign(new Error("Member not found"), { status: 404 });
  if (!meeting) throw Object.assign(new Error(`Scheduled meeting not found for ${meetingDate}`), { status: 404 });

  const bounds = broadUtcBoundsForLocalDate(meetingDate);
  const [scanRows, manualRows] = await Promise.all([
    env.DB.prepare("SELECT id, occurred_at FROM scan_events WHERE student_id = ? AND occurred_at >= ? AND occurred_at < ?")
      .bind(input.memberId, bounds.start, bounds.end)
      .all<{ id: string; occurred_at: string }>(),
    env.DB.prepare("SELECT id, occurred_at FROM manual_events WHERE student_id = ? AND occurred_at >= ? AND occurred_at < ?")
      .bind(input.memberId, bounds.start, bounds.end)
      .all<{ id: string; occurred_at: string }>()
  ]);

  const scanIds = scanRows.results
    .filter((row) => meetingDateForTimestamp(row.occurred_at, env.TIME_ZONE) === meetingDate)
    .map((row) => row.id);
  const manualIds = manualRows.results
    .filter((row) => meetingDateForTimestamp(row.occurred_at, env.TIME_ZONE) === meetingDate)
    .map((row) => row.id);

  const deleteStatements = [
    ...scanIds.map((id) => env.DB.prepare("DELETE FROM scan_events WHERE id = ?").bind(id)),
    ...manualIds.map((id) => env.DB.prepare("DELETE FROM manual_events WHERE id = ?").bind(id))
  ];
  if (deleteStatements.length > 0) await env.DB.batch(deleteStatements);
  await rebuildAttendanceSessions(env);

  return {
    memberId: input.memberId,
    firstName: member.first_name,
    lastName: member.last_name,
    meetingDate,
    meetingTitle: meeting.title,
    reason,
    adminEmail: input.adminEmail,
    deletedScanEvents: scanIds.length,
    deletedManualEvents: manualIds.length,
    deletedAttendanceExclusions: 0,
    confirmation: expectedConfirmation,
    preservedAuditHistory: true,
    preservedAttendanceExclusions: true
  };
}

export async function clearAttendanceForDate(env: Env, input: { meetingDate?: unknown; confirmation?: unknown }) {
  const meetingDate = requireIsoDate(input.meetingDate, "meetingDate");
  const expectedConfirmation = `CLEAR ${meetingDate}`;
  if (input.confirmation !== expectedConfirmation) {
    throw Object.assign(new Error(`Type ${expectedConfirmation} to clear attendance for ${meetingDate}`), { status: 400 });
  }

  const bounds = broadUtcBoundsForLocalDate(meetingDate);
  const [scanRows, manualRows, exclusionRows] = await Promise.all([
    env.DB.prepare("SELECT id, occurred_at FROM scan_events WHERE occurred_at >= ? AND occurred_at < ?")
      .bind(bounds.start, bounds.end)
      .all<{ id: string; occurred_at: string }>(),
    env.DB.prepare("SELECT id, occurred_at FROM manual_events WHERE occurred_at >= ? AND occurred_at < ?")
      .bind(bounds.start, bounds.end)
      .all<{ id: string; occurred_at: string }>(),
    env.DB.prepare("SELECT id FROM attendance_exclusions WHERE meeting_date = ?")
      .bind(meetingDate)
      .all<{ id: string }>()
  ]);

  const scanIds = scanRows.results
    .filter((row) => meetingDateForTimestamp(row.occurred_at, env.TIME_ZONE) === meetingDate)
    .map((row) => row.id);
  const manualIds = manualRows.results
    .filter((row) => meetingDateForTimestamp(row.occurred_at, env.TIME_ZONE) === meetingDate)
    .map((row) => row.id);

  const deleteStatements = [
    ...scanIds.map((id) => env.DB.prepare("DELETE FROM scan_events WHERE id = ?").bind(id)),
    ...manualIds.map((id) => env.DB.prepare("DELETE FROM manual_events WHERE id = ?").bind(id)),
    ...exclusionRows.results.map((row) => env.DB.prepare("DELETE FROM attendance_exclusions WHERE id = ?").bind(row.id))
  ];
  if (deleteStatements.length > 0) await env.DB.batch(deleteStatements);
  await rebuildAttendanceSessions(env);

  return {
    meetingDate,
    deletedScanEvents: scanIds.length,
    deletedManualEvents: manualIds.length,
    deletedAttendanceExclusions: exclusionRows.results.length,
    confirmation: expectedConfirmation
  };
}

function clearMemberAttendanceConfirmation(memberId: string, meetingDate: string): string {
  return `CLEAR ${memberId} ${meetingDate}`;
}

export async function rebuildAttendanceSessions(env: Env): Promise<void> {
  const scans = await env.DB.prepare(
    "SELECT id, student_id, occurred_at, status FROM scan_events WHERE status = 'accepted' ORDER BY occurred_at ASC"
  ).all<{ id: string; student_id: string; occurred_at: string; status: "accepted" }>();
  const manual = await env.DB.prepare(
    "SELECT id, student_id, occurred_at, action, reason, admin_email FROM manual_events ORDER BY occurred_at ASC"
  ).all<{ id: string; student_id: string; occurred_at: string; action: "check_in" | "check_out" | "confirm_present"; reason: string; admin_email: string }>();
  const exclusions = await env.DB.prepare(
    "SELECT student_id, meeting_date FROM attendance_exclusions WHERE superseded_at IS NULL"
  ).all<{ student_id: string; meeting_date: string }>();
  const excludedMemberDates = new Set(exclusions.results.map((row) => `${row.student_id}:${row.meeting_date}`));

  const sessions = deriveAttendanceSessions(
    scans.results.map((row) => ({ id: row.id, memberId: row.student_id, occurredAt: row.occurred_at, status: row.status })),
    manual.results.map((row) => ({
      id: row.id,
      memberId: row.student_id,
      occurredAt: row.occurred_at,
      action: row.action,
      reason: row.reason,
      adminEmail: row.admin_email
    })),
    env.TIME_ZONE
  ).filter((session) => !excludedMemberDates.has(`${session.memberId}:${session.meetingDate}`));

  await env.DB.batch([
    env.DB.prepare("DELETE FROM attendance_sessions"),
    ...sessions.map((session) =>
      env.DB.prepare(
        "INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, check_out_at, status, source_event_ids, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        session.id,
        session.memberId,
        session.meetingDate,
        session.checkInAt,
        session.checkOutAt ?? null,
        session.status,
        JSON.stringify(session.sourceEventIds),
        new Date().toISOString()
      )
    )
  ]);
}

async function insertScanEvent(
  env: Env,
  kioskId: string,
  input: NormalizedKioskSyncEventInput,
  syncedAt: string,
  status: "accepted" | "duplicate" | "rejected",
  rejectionReason?: string
): Promise<ScanEvent> {
  const id = eventId(kioskId, input.localEventId);
  await env.DB.prepare(
    "INSERT INTO scan_events (id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status, rejection_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, kioskId, input.localEventId, input.memberId, input.occurredAt, syncedAt, "fingerprint", status, rejectionReason ?? null).run();
  return { id, kioskId, localEventId: input.localEventId, memberId: input.memberId, occurredAt: input.occurredAt, syncedAt, source: "fingerprint", status };
}

function rowToScanEvent(row: {
  id: string;
  kiosk_id: string;
  local_event_id: string;
  student_id: string;
  occurred_at: string;
  synced_at: string;
  source: "fingerprint";
  status: "accepted" | "duplicate" | "rejected";
}): ScanEvent {
  return {
    id: row.id,
    kioskId: row.kiosk_id,
    localEventId: row.local_event_id,
    memberId: row.student_id,
    occurredAt: row.occurred_at,
    syncedAt: row.synced_at,
    source: row.source,
    status: row.status
  };
}

function broadUtcBoundsForLocalDate(meetingDate: string): { start: string; end: string } {
  const start = new Date(`${meetingDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 2);
  const end = new Date(`${meetingDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 3);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function buildAcknowledgement(env: Env, acknowledgement: AcknowledgementInput): Promise<KioskScanAcknowledgement> {
  const student = await env.DB.prepare(
    "SELECT first_name, last_name FROM students WHERE student_id = ?"
  ).bind(acknowledgement.input.memberId).first<{ first_name: string; last_name: string }>();
  const displayName = student ? `${student.first_name} ${student.last_name}` : undefined;
  const attendance = await attendanceSummary(env, acknowledgement.input.memberId);
  const showAttendanceSummary = kioskShowsAttendanceSummary(env);
  const memberLabel = displayName ?? memberIdLabel(acknowledgement.input.memberId);
  const scannedAt = formatKioskTime(acknowledgement.input.occurredAt, env.TIME_ZONE);

  if (acknowledgement.status === "duplicate") {
    return {
      localEventId: acknowledgement.input.localEventId,
      memberId: acknowledgement.input.memberId,
      status: "duplicate",
      displayName,
      attendanceRate: attendance.rate,
      attendanceSummary: attendance.summary,
      kioskMessage: "Already recorded",
      kioskDetail: `${memberLabel}, your attendance was already recorded. Please wait a moment before scanning again.`,
      message: displayName ? `${displayName} was already recorded.` : "Scan was already recorded."
    };
  }

  if (acknowledgement.status === "rejected") {
    const rosterMessage = acknowledgement.reason === "member is not active in roster" || acknowledgement.reason === "student is not active in roster"
      ? "this Member ID is not active. Ask a mentor for help."
      : "This scan could not be accepted. Ask a mentor for help.";
    return {
      localEventId: acknowledgement.input.localEventId,
      memberId: acknowledgement.input.memberId,
      status: "rejected",
      displayName,
      attendanceRate: attendance.rate,
      attendanceSummary: attendance.summary,
      kioskMessage: "Roster issue",
      kioskDetail: `${memberLabel}, ${rosterMessage}`,
      message: rosterMessage
    };
  }

  const actionLabel = acknowledgement.action === "check_out" ? "Checked out" : "Checked in";
  const greeting = acknowledgement.action === "check_out" ? "Goodbye" : "Welcome";
  const attendanceDetail = showAttendanceSummary ? attendance.summary : undefined;
  return {
    localEventId: acknowledgement.input.localEventId,
    memberId: acknowledgement.input.memberId,
    status: "accepted",
    displayName,
    action: acknowledgement.action,
    attendanceRate: attendance.rate,
    attendanceSummary: attendance.summary,
    kioskMessage: `${greeting}, ${displayName ?? memberIdLabel(acknowledgement.input.memberId)}`,
    kioskDetail: [`${actionLabel} at ${scannedAt}.`, attendanceDetail].filter(Boolean).join(" "),
    message: acknowledgement.action === "check_out" ? `Goodbye, ${displayName ?? memberIdLabel(acknowledgement.input.memberId)}` : `Welcome, ${displayName ?? memberIdLabel(acknowledgement.input.memberId)}`
  };
}

async function actionForAcceptedScan(env: Env, kioskId: string, input: NormalizedKioskSyncEventInput): Promise<"check_in" | "check_out"> {
  const meetingDate = meetingDateForTimestamp(input.occurredAt, env.TIME_ZONE);
  const rows = await env.DB.prepare(
    "SELECT id, occurred_at FROM scan_events WHERE student_id = ? AND status = 'accepted' ORDER BY occurred_at ASC, id ASC"
  ).bind(input.memberId).all<{ id: string; occurred_at: string }>();
  const acceptedForMeeting = rows.results.filter((row) => meetingDateForTimestamp(row.occurred_at, env.TIME_ZONE) === meetingDate);
  const index = acceptedForMeeting.findIndex((row) => row.id === eventId(kioskId, input.localEventId));
  const actionIndex = index >= 0 ? index : acceptedForMeeting.length - 1;
  return actionIndex % 2 === 0 ? "check_in" : "check_out";
}

async function attendanceSummary(env: Env, memberId: string): Promise<{ rate: number | null; summary?: string }> {
  try {
    const report = await buildMemberAttendanceReport(env, memberId, { includeUnscheduled: true });
    if (report.attendanceRate === null) return { rate: null };
    return {
      rate: report.attendanceRate,
      summary: `Attendance ${Math.round(report.attendanceRate * 100)}% (${report.presentMeetings}/${report.totalMeetings})`
    };
  } catch {
    return { rate: null };
  }
}

function normalizeKioskSyncEvent(input: KioskSyncEventInput): NormalizedKioskSyncEventInput {
  const memberId = input.memberId ?? input.studentId;
  if (!memberId?.trim()) throw Object.assign(new Error("memberId is required"), { status: 400 });
  return {
    localEventId: input.localEventId,
    memberId: memberId.trim(),
    occurredAt: input.occurredAt,
    source: input.source
  };
}

type NormalizedKioskSyncEventInput = KioskSyncEventInput & { memberId: string };

function memberIdLabel(memberId: string): string {
  return `Member ID ${memberId}`;
}

function kioskShowsAttendanceSummary(env: Env): boolean {
  const value = env.KIOSK_SHOW_ATTENDANCE_SUMMARY;
  if (value === undefined || value === "") return true;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function formatKioskTime(occurredAt: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "America/New_York"
    }).format(new Date(occurredAt));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York"
    }).format(new Date(occurredAt));
  }
}

interface AcknowledgementInput {
  input: NormalizedKioskSyncEventInput;
  status: ScanEventStatus;
  reason?: string;
  action?: "check_in" | "check_out";
}
