import { describe, expect, it } from "vitest";
import { baseDisplayState } from "../src/kioskStates";
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

  it("shows accepted check-outs as goodbye messages", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-out",
      studentId: "1234",
      status: "accepted",
      action: "check_out",
      displayName: "Test Person",
      attendanceSummary: "Attendance 100% (1/1)",
      message: "Goodbye, Test Person"
    })).toEqual({
      status: "goodbye",
      message: "Goodbye",
      detail: "Test Person - Attendance 100% (1/1)"
    });
  });

  it("shows rejected scans with the acknowledgement message", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-rejected",
      studentId: "qa-inactive",
      status: "rejected",
      message: "Member is not active in the roster."
    })).toEqual({
      status: "rejected",
      message: "Scan rejected",
      detail: "Member is not active in the roster."
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

  it("uses shared base states for transient service statuses", () => {
    const server = new DisplayStateServer();

    server.setProcessing();
    expect(server.current()).toMatchObject(baseDisplayState("processing"));

    server.setUnknownFingerprint();
    expect(server.current()).toMatchObject(baseDisplayState("unknown"));

    server.setOffline(baseDisplayState("offline").detail);
    expect(server.current()).toMatchObject(baseDisplayState("offline"));

    server.setReaderOffline();
    expect(server.current()).toMatchObject(baseDisplayState("reader_offline"));
  });
});
