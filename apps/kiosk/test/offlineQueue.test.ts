import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KioskSyncResult } from "@frc-attendance/shared";
import { OfflineQueue } from "../src/service/offlineQueue";
import { SyncClient } from "../src/service/syncClient";
import type { KioskConfig } from "../src/service/config";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline scan queue restart and reconnect behavior", () => {
  it("keeps unsynced scans pending when the queue is reopened after a restart", () => {
    const databasePath = tempDatabasePath();
    const firstQueue = new OfflineQueue(databasePath);

    firstQueue.addFingerprintScan("100002", "2026-05-28T15:01:00.000Z");
    firstQueue.addFingerprintScan("100001", "2026-05-28T15:00:00.000Z");

    const restartedQueue = new OfflineQueue(databasePath);

    expect(restartedQueue.pending()).toMatchObject([
      {
        memberId: "100001",
        occurredAt: "2026-05-28T15:00:00.000Z",
        source: "fingerprint"
      },
      {
        memberId: "100002",
        occurredAt: "2026-05-28T15:01:00.000Z",
        source: "fingerprint"
      }
    ]);
    expect(restartedQueue.pendingCount()).toBe(2);
  });

  it("leaves scans pending after an outage and clears them after reconnect", async () => {
    const queue = new OfflineQueue(tempDatabasePath());
    const event = queue.addFingerprintScan("100001", "2026-05-28T15:00:00.000Z");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "temporary outage"
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async (): Promise<KioskSyncResult> => ({
          accepted: [{
            id: `bench-01:${event.localEventId}`,
            kioskId: "bench-01",
            localEventId: event.localEventId,
            memberId: event.memberId,
            occurredAt: event.occurredAt,
            source: "fingerprint",
            status: "accepted"
          }],
          duplicates: [],
          rejected: []
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const sync = new SyncClient(testConfig(), queue);

    await expect(sync.flushPending()).rejects.toThrow("Sync failed: 503 temporary outage");
    expect(queue.pending()).toMatchObject([{
      localEventId: event.localEventId,
      syncError: "temporary outage"
    }]);

    await expect(sync.flushPending()).resolves.toMatchObject({
      accepted: [{ localEventId: event.localEventId }],
      duplicates: [],
      rejected: []
    });
    expect(queue.pending()).toEqual([]);
    expect(queue.pendingCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function tempDatabasePath(): string {
  return join(mkdtempSync(join(tmpdir(), "frc-kiosk-queue-")), "kiosk-cache.sqlite");
}

function testConfig(): KioskConfig {
  return {
    kioskId: "bench-01",
    apiBaseUrl: "https://api.example.test",
    kioskToken: "test-token",
    databasePath: ":memory:",
    pythonPath: "python3",
    fingerprintBridgePath: "./fingerprint_bridge.py",
    commandPollSeconds: 10,
    displayStatePort: 8788,
    selfRestartDelayMs: 1000,
    systemRebootDelayMs: 1000
  };
}
