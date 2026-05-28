import { describe, expect, it } from "vitest";
import { displayStateForAcknowledgement } from "../src/service/displayStateServer";

describe("display state acknowledgements", () => {
  it("shows accepted check-ins as welcome messages", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-1",
      studentId: "100001",
      status: "accepted",
      action: "check_in",
      displayName: "Bench Student",
      attendanceSummary: "Attendance 100% (1/1)",
      message: "Welcome, Bench Student"
    })).toEqual({
      status: "welcome",
      message: "Welcome",
      detail: "Bench Student - Attendance 100% (1/1)"
    });
  });

  it("shows duplicate scans without changing attendance action", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-2",
      studentId: "100001",
      status: "duplicate",
      displayName: "Bench Student",
      message: "Bench Student was already recorded."
    })).toEqual({
      status: "duplicate",
      message: "Already recorded",
      detail: "Bench Student"
    });
  });
});
