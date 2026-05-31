import { describe, expect, it } from "vitest";
import type { KioskScanAcknowledgement, KioskSyncResult, ScanEvent } from "@frc-attendance/shared";
import { ledStateForAcknowledgement, ledStateForSyncResult } from "../src/service/kioskStateDecisions";

const ack = (overrides: Partial<KioskScanAcknowledgement>): KioskScanAcknowledgement => ({
  localEventId: "local-1",
  studentId: "1234",
  status: "accepted",
  action: "check_in",
  message: "ok",
  ...overrides
});

const scan = (localEventId: string, status: ScanEvent["status"]): ScanEvent => ({
  id: `bench-01:${localEventId}`,
  kioskId: "bench-01",
  localEventId,
  studentId: "1234",
  occurredAt: "2026-05-31T12:00:00.000Z",
  source: "fingerprint",
  status
});

describe("kiosk LED state decisions", () => {
  it("maps accepted acknowledgement actions to welcome and goodbye states", () => {
    expect(ledStateForAcknowledgement(ack({ action: "check_in" }))).toBe("welcome");
    expect(ledStateForAcknowledgement(ack({ action: "check_out" }))).toBe("goodbye");
  });

  it("maps duplicate and rejected acknowledgements directly", () => {
    expect(ledStateForAcknowledgement(ack({ status: "duplicate", action: undefined }))).toBe("duplicate");
    expect(ledStateForAcknowledgement(ack({ status: "rejected", action: undefined }))).toBe("rejected");
  });

  it("maps fallback sync results to equivalent LED states", () => {
    const result: KioskSyncResult = {
      accepted: [scan("accepted-1", "accepted")],
      duplicates: [scan("duplicate-1", "duplicate")],
      rejected: [{ localEventId: "rejected-1", studentId: "1234", occurredAt: "2026-05-31T12:00:00.000Z", source: "fingerprint", reason: "student is not active in roster" }]
    };

    expect(ledStateForSyncResult("accepted-1", result)).toBe("welcome");
    expect(ledStateForSyncResult("duplicate-1", result)).toBe("duplicate");
    expect(ledStateForSyncResult("rejected-1", result)).toBe("rejected");
    expect(ledStateForSyncResult("missing-1", result)).toBeUndefined();
  });
});
