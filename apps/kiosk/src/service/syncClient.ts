import type { KioskSyncResult } from "@frc-attendance/shared";
import type { KioskConfig } from "./config";
import type { OfflineQueue } from "./offlineQueue";

export class SyncClient {
  constructor(private readonly config: KioskConfig, private readonly queue: OfflineQueue) {}

  async flushPending(): Promise<KioskSyncResult | null> {
    const events = this.queue.pending();
    if (events.length === 0) return null;

    const response = await fetch(`${this.config.apiBaseUrl}/kiosk/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.kioskToken}`
      },
      body: JSON.stringify({
        kioskId: this.config.kioskId,
        events: events.map(({ localEventId, studentId, occurredAt, source }) => ({ localEventId, studentId, occurredAt, source }))
      })
    });

    if (!response.ok) {
      const message = await response.text();
      this.queue.markErrored(events.map((event) => event.localEventId), message);
      throw new Error(`Sync failed: ${response.status} ${message}`);
    }

    const result = (await response.json()) as KioskSyncResult;
    this.queue.markSynced([
      ...result.accepted.map((event) => event.localEventId),
      ...result.duplicates.map((event) => event.localEventId),
      ...result.rejected.map((event) => event.localEventId)
    ]);
    return result;
  }
}
