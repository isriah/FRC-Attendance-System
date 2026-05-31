import { DEFAULT_DUPLICATE_WINDOW_MS, deriveAttendanceSessions, isDuplicateScan, meetingDateForTimestamp } from "@frc-attendance/shared";
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

  for (const input of events) {
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
        action: event.status === "accepted" ? await actionForAcceptedScan(env, input) : undefined
      });
      continue;
    }

    const student = await env.DB.prepare("SELECT active FROM students WHERE student_id = ?").bind(input.studentId).first<{ active: number }>();
    if (!student || !student.active) {
      const reason = "student is not active in roster";
      rejected.push({ ...input, reason });
      await insertScanEvent(env, kioskId, input, now, "rejected", reason);
      acknowledgementInputs.push({ input, status: "rejected", reason });
      continue;
    }

    const previous = await env.DB.prepare(
      "SELECT id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status FROM scan_events WHERE student_id = ? AND status = 'accepted' ORDER BY occurred_at DESC LIMIT 1"
    ).bind(input.studentId).first<Parameters<typeof rowToScanEvent>[0]>();

    if (isDuplicateScan(previous ? rowToScanEvent(previous) : undefined, input, duplicateWindow)) {
      const event = await insertScanEvent(env, kioskId, input, now, "duplicate", "duplicate scan window");
      duplicates.push(event);
      acknowledgementInputs.push({ input, status: "duplicate", reason: "duplicate scan window" });
      continue;
    }

    const event = await insertScanEvent(env, kioskId, input, now, "accepted");
    accepted.push(event);
    acknowledgementInputs.push({ input, status: "accepted", action: await actionForAcceptedScan(env, input) });
  }

  if (accepted.length > 0) await rebuildAttendanceSessions(env);
  return {
    accepted,
    duplicates,
    rejected,
    acknowledgements: await Promise.all(acknowledgementInputs.map((acknowledgement) => buildAcknowledgement(env, acknowledgement)))
  };
}

export async function addManualEvent(env: Env, input: { studentId: string; occurredAt: string; action: "check_in" | "check_out"; reason: string; adminEmail: string }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO manual_events (id, student_id, occurred_at, action, reason, admin_email) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, input.studentId, input.occurredAt, input.action, input.reason, input.adminEmail).run();
  await rebuildAttendanceSessions(env);
  return { id, ...input };
}

export async function rebuildAttendanceSessions(env: Env): Promise<void> {
  const scans = await env.DB.prepare(
    "SELECT id, student_id, occurred_at, status FROM scan_events WHERE status = 'accepted' ORDER BY occurred_at ASC"
  ).all<{ id: string; student_id: string; occurred_at: string; status: "accepted" }>();
  const manual = await env.DB.prepare(
    "SELECT id, student_id, occurred_at, action, reason, admin_email FROM manual_events ORDER BY occurred_at ASC"
  ).all<{ id: string; student_id: string; occurred_at: string; action: "check_in" | "check_out"; reason: string; admin_email: string }>();

  const sessions = deriveAttendanceSessions(
    scans.results.map((row) => ({ id: row.id, studentId: row.student_id, occurredAt: row.occurred_at, status: row.status })),
    manual.results.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      occurredAt: row.occurred_at,
      action: row.action,
      reason: row.reason,
      adminEmail: row.admin_email
    })),
    env.TIME_ZONE
  );

  await env.DB.batch([
    env.DB.prepare("DELETE FROM attendance_sessions"),
    ...sessions.map((session) =>
      env.DB.prepare(
        "INSERT INTO attendance_sessions (id, student_id, meeting_date, check_in_at, check_out_at, status, source_event_ids, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        session.id,
        session.studentId,
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
  input: KioskSyncEventInput,
  syncedAt: string,
  status: "accepted" | "duplicate" | "rejected",
  rejectionReason?: string
): Promise<ScanEvent> {
  const id = eventId(kioskId, input.localEventId);
  await env.DB.prepare(
    "INSERT INTO scan_events (id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status, rejection_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, kioskId, input.localEventId, input.studentId, input.occurredAt, syncedAt, "fingerprint", status, rejectionReason ?? null).run();
  return { id, kioskId, localEventId: input.localEventId, studentId: input.studentId, occurredAt: input.occurredAt, syncedAt, source: "fingerprint", status };
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
    studentId: row.student_id,
    occurredAt: row.occurred_at,
    syncedAt: row.synced_at,
    source: row.source,
    status: row.status
  };
}

async function buildAcknowledgement(env: Env, acknowledgement: AcknowledgementInput): Promise<KioskScanAcknowledgement> {
  const student = await env.DB.prepare(
    "SELECT first_name, last_name FROM students WHERE student_id = ?"
  ).bind(acknowledgement.input.studentId).first<{ first_name: string; last_name: string }>();
  const displayName = student ? `${student.first_name} ${student.last_name}` : undefined;
  const attendance = await attendanceSummary(env, acknowledgement.input.studentId);

  if (acknowledgement.status === "duplicate") {
    return {
      localEventId: acknowledgement.input.localEventId,
      studentId: acknowledgement.input.studentId,
      status: "duplicate",
      displayName,
      attendanceRate: attendance.rate,
      attendanceSummary: attendance.summary,
      message: displayName ? `${displayName} was already recorded.` : "Scan was already recorded."
    };
  }

  if (acknowledgement.status === "rejected") {
    return {
      localEventId: acknowledgement.input.localEventId,
      studentId: acknowledgement.input.studentId,
      status: "rejected",
      displayName,
      attendanceRate: attendance.rate,
      attendanceSummary: attendance.summary,
      message: acknowledgement.reason === "student is not active in roster" ? "Member is not active in the roster." : "Scan could not be accepted."
    };
  }

  return {
    localEventId: acknowledgement.input.localEventId,
    studentId: acknowledgement.input.studentId,
    status: "accepted",
    displayName,
    action: acknowledgement.action,
    attendanceRate: attendance.rate,
    attendanceSummary: attendance.summary,
    message: acknowledgement.action === "check_out" ? `Goodbye, ${displayName ?? acknowledgement.input.studentId}` : `Welcome, ${displayName ?? acknowledgement.input.studentId}`
  };
}

async function actionForAcceptedScan(env: Env, input: KioskSyncEventInput): Promise<"check_in" | "check_out"> {
  const meetingDate = meetingDateForTimestamp(input.occurredAt, env.TIME_ZONE);
  const rows = await env.DB.prepare(
    "SELECT id, occurred_at FROM scan_events WHERE student_id = ? AND status = 'accepted' ORDER BY occurred_at ASC, id ASC"
  ).bind(input.studentId).all<{ id: string; occurred_at: string }>();
  const acceptedForMeeting = rows.results.filter((row) => meetingDateForTimestamp(row.occurred_at, env.TIME_ZONE) === meetingDate);
  return acceptedForMeeting.length % 2 === 0 ? "check_out" : "check_in";
}

async function attendanceSummary(env: Env, studentId: string): Promise<{ rate: number | null; summary?: string }> {
  try {
    const report = await buildMemberAttendanceReport(env, studentId);
    if (report.attendanceRate === null) return { rate: null };
    return {
      rate: report.attendanceRate,
      summary: `Attendance ${Math.round(report.attendanceRate * 100)}% (${report.presentMeetings}/${report.totalMeetings})`
    };
  } catch {
    return { rate: null };
  }
}

interface AcknowledgementInput {
  input: KioskSyncEventInput;
  status: ScanEventStatus;
  reason?: string;
  action?: "check_in" | "check_out";
}
