import { describe, expect, it } from "vitest";
import { deriveAttendanceSessions, hasAttendanceCredit, isDuplicateScan, meetingDateForTimestamp } from "../src/attendance";
import type { ScanEvent } from "../src/types";

const scan = (id: string, memberId: string, occurredAt: string): ScanEvent => ({
  id,
  kioskId: "kiosk-a",
  localEventId: id,
  memberId,
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
    expect(isDuplicateScan(previous, { memberId: "123", occurredAt: "2026-01-01T20:01:00.000Z" })).toBe(true);
    expect(isDuplicateScan(previous, { memberId: "123", occurredAt: "2026-01-01T20:01:30.000Z" })).toBe(true);
    expect(isDuplicateScan(previous, { memberId: "123", occurredAt: "2026-01-01T20:01:31.000Z" })).toBe(false);
    expect(isDuplicateScan(previous, { memberId: "456", occurredAt: "2026-01-01T20:01:00.000Z" })).toBe(false);
  });

  it("auto toggles check-in and check-out sessions", () => {
    const sessions = deriveAttendanceSessions([
      scan("in", "123", "2026-01-01T20:00:00.000Z"),
      scan("out", "123", "2026-01-01T22:00:00.000Z")
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      memberId: "123",
      status: "closed",
      checkInAt: "2026-01-01T20:00:00.000Z",
      checkOutAt: "2026-01-01T22:00:00.000Z"
    });
  });

  it("continues normal check-in and check-out alternation for later scans", () => {
    const sessions = deriveAttendanceSessions([
      scan("first-in", "123", "2026-01-01T20:00:00.000Z"),
      scan("first-out", "123", "2026-01-01T21:00:00.000Z"),
      scan("second-in", "123", "2026-01-01T22:00:00.000Z"),
      scan("second-out", "123", "2026-01-01T23:00:00.000Z")
    ]);

    expect(sessions).toEqual([
      expect.objectContaining({
        memberId: "123",
        status: "closed",
        checkInAt: "2026-01-01T20:00:00.000Z",
        checkOutAt: "2026-01-01T21:00:00.000Z",
        sourceEventIds: ["first-in", "first-out"]
      }),
      expect.objectContaining({
        memberId: "123",
        status: "closed",
        checkInAt: "2026-01-01T22:00:00.000Z",
        checkOutAt: "2026-01-01T23:00:00.000Z",
        sourceEventIds: ["second-in", "second-out"]
      })
    ]);
  });

  it("leaves sessions open when checkout is missing", () => {
    const sessions = deriveAttendanceSessions([scan("in", "123", "2026-01-01T20:00:00.000Z")]);
    expect(sessions[0]?.status).toBe("open");
    expect(sessions[0]?.checkOutAt).toBeUndefined();
    expect(hasAttendanceCredit(sessions[0]!)).toBe(false);
  });

  it("earns credit once a later checkout closes an open session", () => {
    const sessions = deriveAttendanceSessions([
      scan("in", "123", "2026-01-01T20:00:00.000Z"),
      scan("out", "123", "2026-01-01T22:00:00.000Z")
    ]);
    expect(hasAttendanceCredit(sessions[0]!)).toBe(true);
  });

  it("records a confirm-present correction without duplicating an existing session", () => {
    const sessions = deriveAttendanceSessions([
      scan("in", "123", "2026-01-01T20:00:00.000Z"),
      scan("out", "123", "2026-01-01T22:00:00.000Z")
    ], [{
      id: "contest-approval",
      memberId: "123",
      occurredAt: "2026-01-01T21:00:00.000Z",
      action: "confirm_present",
      reason: "Discord contest approved",
      adminEmail: "mentor@example.com"
    }]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sourceEventIds).toEqual(["in", "out", "contest-approval"]);
  });

  it("creates attendance when confirm-present is the only event", () => {
    const sessions = deriveAttendanceSessions([], [{
      id: "contest-approval",
      memberId: "123",
      occurredAt: "2026-01-01T20:00:00.000Z",
      action: "confirm_present",
      reason: "Discord contest approved",
      adminEmail: "mentor@example.com"
    }]);

    expect(sessions).toEqual([expect.objectContaining({
      memberId: "123",
      meetingDate: "2026-01-01",
      status: "closed",
      sourceEventIds: ["contest-approval"]
    })]);
  });
});
