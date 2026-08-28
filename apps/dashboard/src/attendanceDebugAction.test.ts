import { describe, expect, it } from "vitest";
import { buildClearMemberAttendanceSourceDataPayload, clearMemberAttendanceConfirmation } from "./attendanceDebugAction";

describe("attendance debugging actions", () => {
  it("builds the clear-member source-data payload with the exact typed confirmation", () => {
    expect(clearMemberAttendanceConfirmation("100001", "2026-01-05")).toBe("CLEAR 100001 2026-01-05");
    expect(buildClearMemberAttendanceSourceDataPayload({
      memberId: "100001",
      meetingDate: "2026-01-05",
      reasonInput: "  Removing incorrect sensor debug data  ",
      confirmationInput: "CLEAR 100001 2026-01-05"
    })).toEqual({
      memberId: "100001",
      meetingDate: "2026-01-05",
      reason: "Removing incorrect sensor debug data",
      confirmation: "CLEAR 100001 2026-01-05"
    });
  });

  it("cancels cleanly when either destructive prompt is dismissed", () => {
    expect(buildClearMemberAttendanceSourceDataPayload({
      memberId: "100001",
      meetingDate: "2026-01-05",
      reasonInput: null,
      confirmationInput: "CLEAR 100001 2026-01-05"
    })).toBeNull();
    expect(buildClearMemberAttendanceSourceDataPayload({
      memberId: "100001",
      meetingDate: "2026-01-05",
      reasonInput: "Removing incorrect sensor debug data",
      confirmationInput: null
    })).toBeNull();
  });

  it("requires a meaningful debugging note", () => {
    expect(() => buildClearMemberAttendanceSourceDataPayload({
      memberId: "100001",
      meetingDate: "2026-01-05",
      reasonInput: "debug",
      confirmationInput: "CLEAR 100001 2026-01-05"
    })).toThrow("A debugging note of at least 10 characters is required to clear attendance data.");
  });
});
