import type { AttendanceSession, ManualEvent, ScanEvent } from "./types";

export const DEFAULT_DUPLICATE_WINDOW_MS = 90_000;

export function meetingDateForTimestamp(isoTimestamp: string, timeZone = "America/New_York"): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${isoTimestamp}`);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Unable to format meeting date");
  return `${year}-${month}-${day}`;
}

export function isDuplicateScan(previous: ScanEvent | undefined, next: Pick<ScanEvent, "studentId" | "occurredAt">, windowMs = DEFAULT_DUPLICATE_WINDOW_MS): boolean {
  if (!previous) return false;
  if (previous.studentId !== next.studentId) return false;
  const delta = Math.abs(new Date(next.occurredAt).getTime() - new Date(previous.occurredAt).getTime());
  return delta <= windowMs;
}

export function deriveAttendanceSessions(
  events: Array<Pick<ScanEvent, "id" | "studentId" | "occurredAt" | "status">>,
  manualEvents: ManualEvent[] = [],
  timeZone = "America/New_York"
): AttendanceSession[] {
  const normalized = [
    ...events
      .filter((event) => event.status === "accepted")
      .map((event) => ({
        id: event.id,
        studentId: event.studentId,
        occurredAt: event.occurredAt,
        forcedAction: undefined as ManualEvent["action"] | undefined
      })),
    ...manualEvents.map((event) => ({
      id: event.id,
      studentId: event.studentId,
      occurredAt: event.occurredAt,
      forcedAction: event.action
    }))
  ].sort((a, b) => {
    const timeDelta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    return timeDelta || a.id.localeCompare(b.id);
  });

  const sessions: AttendanceSession[] = [];
  const openByStudentDate = new Map<string, AttendanceSession>();

  for (const event of normalized) {
    const meetingDate = meetingDateForTimestamp(event.occurredAt, timeZone);
    const key = `${event.studentId}:${meetingDate}`;
    const open = openByStudentDate.get(key);
    const shouldCheckOut = event.forcedAction === "check_out" || (!event.forcedAction && Boolean(open));

    if (shouldCheckOut && open) {
      open.checkOutAt = event.occurredAt;
      open.status = "closed";
      open.sourceEventIds.push(event.id);
      openByStudentDate.delete(key);
      continue;
    }

    if (event.forcedAction === "check_out" && !open) {
      sessions.push({
        id: `session:${event.studentId}:${meetingDate}:${event.id}`,
        studentId: event.studentId,
        meetingDate,
        checkInAt: event.occurredAt,
        checkOutAt: event.occurredAt,
        status: "closed",
        sourceEventIds: [event.id]
      });
      continue;
    }

    const session: AttendanceSession = {
      id: `session:${event.studentId}:${meetingDate}:${event.id}`,
      studentId: event.studentId,
      meetingDate,
      checkInAt: event.occurredAt,
      status: "open",
      sourceEventIds: [event.id]
    };
    sessions.push(session);
    openByStudentDate.set(key, session);
  }

  return sessions;
}
