import { describe, expect, it } from "vitest";
import { DisplayStateServer, displayStateForAcknowledgement } from "../src/service/displayStateServer";

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

  it("falls back to member IDs when the sync result has no acknowledgement", () => {
    const server = new DisplayStateServer();
    server.setSyncResult("local-3", "100001", {
      accepted: [{
        id: "bench-01:local-3",
        kioskId: "bench-01",
        localEventId: "local-3",
        studentId: "100001",
        occurredAt: new Date().toISOString(),
        source: "fingerprint",
        status: "accepted"
      }],
      duplicates: [],
      rejected: []
    });

    expect(server.current()).toMatchObject({
      status: "welcome",
      message: "Scan accepted",
      detail: "Member 100001"
    });
  });
});
