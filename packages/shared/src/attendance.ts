import type { AttendanceSession, ManualEvent, ScanEvent } from "./types";

export const DEFAULT_DUPLICATE_WINDOW_MS = 90_000;

/** A closed scan pair, or an audited mentor confirmation, earns attendance credit. */
export function hasAttendanceCredit(session: Pick<AttendanceSession, "status">): boolean {
  return session.status === "closed";
}

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

export function isDuplicateScan(previous: ScanEvent | undefined, next: Pick<ScanEvent, "memberId" | "occurredAt">, windowMs = DEFAULT_DUPLICATE_WINDOW_MS): boolean {
  if (!previous) return false;
  if (previous.memberId !== next.memberId) return false;
  const delta = Math.abs(new Date(next.occurredAt).getTime() - new Date(previous.occurredAt).getTime());
  return delta <= windowMs;
}

export function deriveAttendanceSessions(
  events: Array<Pick<ScanEvent, "id" | "memberId" | "occurredAt" | "status">>,
  manualEvents: ManualEvent[] = [],
  timeZone = "America/New_York"
): AttendanceSession[] {
  const normalized = [
    ...events
      .filter((event) => event.status === "accepted")
      .map((event) => ({
        id: event.id,
        memberId: event.memberId,
        occurredAt: event.occurredAt,
        forcedAction: undefined as ManualEvent["action"] | undefined
      })),
    ...manualEvents.filter((event) => event.action !== "confirm_present").map((event) => ({
      id: event.id,
      memberId: event.memberId,
      occurredAt: event.occurredAt,
      forcedAction: event.action
    }))
  ].sort((a, b) => {
    const timeDelta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    return timeDelta || a.id.localeCompare(b.id);
  });
  const presentConfirmations = manualEvents
    .filter((event) => event.action === "confirm_present")
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() || a.id.localeCompare(b.id));

  const sessions: AttendanceSession[] = [];
  const openByMemberDate = new Map<string, AttendanceSession>();
  const lastByMemberDate = new Map<string, AttendanceSession>();

  for (const event of normalized) {
    const meetingDate = meetingDateForTimestamp(event.occurredAt, timeZone);
    const key = `${event.memberId}:${meetingDate}`;
    const open = openByMemberDate.get(key);
    const shouldCheckOut = event.forcedAction === "check_out" || (!event.forcedAction && Boolean(open));

    if (shouldCheckOut && open) {
      open.checkOutAt = event.occurredAt;
      open.status = "closed";
      open.sourceEventIds.push(event.id);
      openByMemberDate.delete(key);
      continue;
    }

    if (event.forcedAction === "check_out" && !open) {
      sessions.push({
        id: `session:${event.memberId}:${meetingDate}:${event.id}`,
        memberId: event.memberId,
        meetingDate,
        checkInAt: event.occurredAt,
        checkOutAt: event.occurredAt,
        status: "closed",
        sourceEventIds: [event.id]
      });
      lastByMemberDate.set(key, sessions[sessions.length - 1]!);
      continue;
    }

    const session: AttendanceSession = {
      id: `session:${event.memberId}:${meetingDate}:${event.id}`,
      memberId: event.memberId,
      meetingDate,
      checkInAt: event.occurredAt,
      status: "open",
      sourceEventIds: [event.id]
    };
    sessions.push(session);
    openByMemberDate.set(key, session);
    lastByMemberDate.set(key, session);
  }

  // A presence confirmation is an audited correction, not another toggle in the scan sequence.
  // Attach it to existing attendance when possible so approving a contest cannot create duplicate sessions.
  for (const event of presentConfirmations) {
    const meetingDate = meetingDateForTimestamp(event.occurredAt, timeZone);
    const key = `${event.memberId}:${meetingDate}`;
    const last = lastByMemberDate.get(key);
    if (last) {
      last.sourceEventIds.push(event.id);
      if (last.status === "open") {
        last.checkOutAt = event.occurredAt;
        last.status = "closed";
      }
      continue;
    }
    const session: AttendanceSession = {
      id: `session:${event.memberId}:${meetingDate}:${event.id}`,
      memberId: event.memberId,
      meetingDate,
      checkInAt: event.occurredAt,
      checkOutAt: event.occurredAt,
      status: "closed",
      sourceEventIds: [event.id]
    };
    sessions.push(session);
    lastByMemberDate.set(key, session);
  }

  return sessions;
}
