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

  it("replays restarted scans in occurrence order with stable local event IDs", async () => {
    const databasePath = tempDatabasePath();
    const firstQueue = new OfflineQueue(databasePath);
    const later = firstQueue.addFingerprintScan("100002", "2026-05-28T15:01:00.000Z");
    const earlier = firstQueue.addFingerprintScan("100001", "2026-05-28T15:00:00.000Z");
    const restartedQueue = new OfflineQueue(databasePath);

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { kioskId: string; events: Array<{ localEventId: string; memberId: string; occurredAt: string; source: "fingerprint" }> };
      return {
        ok: true,
        json: async (): Promise<KioskSyncResult> => ({
          accepted: body.events.map((event) => scanResult(body.kioskId, event, "accepted")),
          duplicates: [],
          rejected: []
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SyncClient(testConfig(), restartedQueue).flushPending()).resolves.toMatchObject({
      accepted: [
        { localEventId: earlier.localEventId, memberId: "100001" },
        { localEventId: later.localEventId, memberId: "100002" }
      ]
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    if (!requestInit) throw new Error("Expected sync request to be sent");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      kioskId: "bench-01",
      events: [
        { localEventId: earlier.localEventId, memberId: "100001", occurredAt: earlier.occurredAt, source: "fingerprint" },
        { localEventId: later.localEventId, memberId: "100002", occurredAt: later.occurredAt, source: "fingerprint" }
      ]
    });
    expect(restartedQueue.pending()).toEqual([]);
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

  it("keeps every pending scan cached after repeated failed sync attempts", async () => {
    const queue = new OfflineQueue(tempDatabasePath());
    const first = queue.addFingerprintScan("100001", "2026-05-28T15:00:00.000Z");
    const second = queue.addFingerprintScan("100002", "2026-05-28T15:01:00.000Z");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "temporary outage"
      })
      .mockRejectedValueOnce(new Error("network unreachable"));
    vi.stubGlobal("fetch", fetchMock);

    const sync = new SyncClient(testConfig(), queue);

    await expect(sync.flushPending()).rejects.toThrow("Sync failed: 503 temporary outage");
    expect(queue.pending()).toMatchObject([
      { localEventId: first.localEventId, memberId: "100001", syncError: "temporary outage" },
      { localEventId: second.localEventId, memberId: "100002", syncError: "temporary outage" }
    ]);

    await expect(sync.flushPending()).rejects.toThrow("network unreachable");
    expect(queue.pending()).toMatchObject([
      { localEventId: first.localEventId, memberId: "100001", syncError: "temporary outage" },
      { localEventId: second.localEventId, memberId: "100002", syncError: "temporary outage" }
    ]);
    expect(queue.pendingCount()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears duplicate and rejected local events after the API accounts for them", async () => {
    const queue = new OfflineQueue(tempDatabasePath());
    const accepted = queue.addFingerprintScan("100001", "2026-05-28T15:00:00.000Z");
    const duplicate = queue.addFingerprintScan("100001", "2026-05-28T15:00:30.000Z");
    const rejected = queue.addFingerprintScan("999999", "2026-05-28T15:01:00.000Z");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<KioskSyncResult> => ({
        accepted: [scanResult("bench-01", accepted, "accepted")],
        duplicates: [scanResult("bench-01", duplicate, "duplicate")],
        rejected: [{ ...rejected, reason: "member is not active in roster" }]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new SyncClient(testConfig(), queue).flushPending()).resolves.toMatchObject({
      accepted: [{ localEventId: accepted.localEventId }],
      duplicates: [{ localEventId: duplicate.localEventId }],
      rejected: [{ localEventId: rejected.localEventId }]
    });

    expect(queue.pending()).toEqual([]);
    expect(queue.pendingCount()).toBe(0);
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
    networkPinPath: "./test-network-pin.json",
    pythonPath: "python3",
    fingerprintBridgePath: "./fingerprint_bridge.py",
    commandPollSeconds: 10,
    displayStatePort: 8788,
    selfRestartDelayMs: 1000,
    systemRebootDelayMs: 1000
  };
}

function scanResult(kioskId: string, event: { localEventId: string; memberId: string; occurredAt: string; source: "fingerprint" }, status: "accepted" | "duplicate") {
  return {
    id: `${kioskId}:${event.localEventId}`,
    kioskId,
    localEventId: event.localEventId,
    memberId: event.memberId,
    occurredAt: event.occurredAt,
    source: event.source,
    status
  };
}
