import type { KioskScanAcknowledgement, KioskSyncResult } from "@frc-attendance/shared";
import type { KioskStateId } from "../kioskStates";

export function ledStateForAcknowledgement(acknowledgement: KioskScanAcknowledgement): KioskStateId {
  if (acknowledgement.status === "accepted") {
    return acknowledgement.action === "check_out" ? "goodbye" : "welcome";
  }
  return acknowledgement.status;
}

export function ledStateForSyncResult(localEventId: string, result: KioskSyncResult): KioskStateId | undefined {
  if (result.accepted.some((scan) => scan.localEventId === localEventId)) return "welcome";
  if (result.duplicates.some((scan) => scan.localEventId === localEventId)) return "duplicate";
  if (result.rejected.some((scan) => scan.localEventId === localEventId)) return "rejected";
  return undefined;
}
