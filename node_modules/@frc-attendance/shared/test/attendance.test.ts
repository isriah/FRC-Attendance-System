import { describe, expect, it } from "vitest";
import { deriveAttendanceSessions, isDuplicateScan, meetingDateForTimestamp } from "../src/attendance";
import type { ScanEvent } from "../src/types";

const scan = (id: string, studentId: string, occurredAt: string): ScanEvent => ({
  id,
  kioskId: "kiosk-a",
  localEventId: id,
  studentId,
  occurredAt,
  source: "fingerprint",
  status: "accepted"
});

describe("attendance rules", () => {
  it("formats meeting dates in the configured timezone", () => {
    expect(meetingDateForTimestamp("2026-01-02T02:00:00.000Z", "America/New_York")).toBe("2026-01-01");
  });

  it("suppresses scans within the duplicate window", () => {
    const previous = scan("a", "123", "2026-01-01T20:00:00.000Z");
    expect(isDuplicateScan(previous, { studentId: "123", occurredAt: "2026-01-01T20:01:00.000Z" })).toBe(true);
    expect(isDuplicateScan(previous, { studentId: "123", occurredAt: "2026-01-01T20:02:00.000Z" })).toBe(false);
  });

  it("auto toggles check-in and check-out sessions", () => {
    const sessions = deriveAttendanceSessions([
      scan("in", "123", "2026-01-01T20:00:00.000Z"),
      scan("out", "123", "2026-01-01T22:00:00.000Z")
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      studentId: "123",
      status: "closed",
      checkInAt: "2026-01-01T20:00:00.000Z",
      checkOutAt: "2026-01-01T22:00:00.000Z"
    });
  });

  it("leaves sessions open when checkout is missing", () => {
    const sessions = deriveAttendanceSessions([scan("in", "123", "2026-01-01T20:00:00.000Z")]);
    expect(sessions[0]?.status).toBe("open");
    expect(sessions[0]?.checkOutAt).toBeUndefined();
  });
});
