import { DEFAULT_DUPLICATE_WINDOW_MS, deriveAttendanceSessions, isDuplicateScan } from "@frc-attendance/shared";
import type { KioskSyncEventInput, KioskSyncResult, ScanEvent } from "@frc-attendance/shared";
import type { Env } from "./env";

const eventId = (kioskId: string, localEventId: string) => `${kioskId}:${localEventId}`;

export async function syncKioskEvents(env: Env, kioskId: string, events: KioskSyncEventInput[]): Promise<KioskSyncResult> {
  const accepted: ScanEvent[] = [];
  const duplicates: ScanEvent[] = [];
  const rejected: KioskSyncResult["rejected"] = [];
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
      continue;
    }

    const student = await env.DB.prepare("SELECT active FROM students WHERE student_id = ?").bind(input.studentId).first<{ active: number }>();
    if (!student || !student.active) {
      rejected.push({ ...input, reason: "student is not active in roster" });
      await insertScanEvent(env, kioskId, input, now, "rejected", "student is not active in roster");
      continue;
    }

    const previous = await env.DB.prepare(
      "SELECT id, kiosk_id, local_event_id, student_id, occurred_at, synced_at, source, status FROM scan_events WHERE student_id = ? AND status = 'accepted' ORDER BY occurred_at DESC LIMIT 1"
    ).bind(input.studentId).first<Parameters<typeof rowToScanEvent>[0]>();

    if (isDuplicateScan(previous ? rowToScanEvent(previous) : undefined, input, duplicateWindow)) {
      const event = await insertScanEvent(env, kioskId, input, now, "duplicate", "duplicate scan window");
      duplicates.push(event);
      continue;
    }

    const event = await insertScanEvent(env, kioskId, input, now, "accepted");
    accepted.push(event);
  }

  if (accepted.length > 0) await rebuildAttendanceSessions(env);
  return { accepted, duplicates, rejected };
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
