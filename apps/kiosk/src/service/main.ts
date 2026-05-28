import { loadConfig } from "./config";
import { FingerprintBridge, type FingerprintBridgeEvent } from "./fingerprintBridge";
import { OfflineQueue } from "./offlineQueue";
import { SyncClient } from "./syncClient";

const config = loadConfig();
const queue = new OfflineQueue(config.databasePath);
const sync = new SyncClient(config, queue);
const bridge = new FingerprintBridge();

bridge.on("bridge-event", async (event: FingerprintBridgeEvent) => {
  if (event.type === "match") {
    const local = queue.addFingerprintScan(event.studentId);
    console.log(`Queued scan ${local.localEventId} for student ${event.studentId}`);
    try {
      const result = await sync.flushPending();
      const acknowledgement = result?.acknowledgements?.find((ack) => ack.localEventId === local.localEventId);
      if (acknowledgement) console.log(`Scan acknowledged: ${acknowledgement.message}`);
      console.log("Synced pending scans");
    } catch (error) {
      console.log(`Offline or sync failed; scan remains cached: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (event.type === "no-match") {
    console.log("Fingerprint was not recognized");
    sync.reportNoMatch().catch((error) => console.log(`Could not report unknown fingerprint: ${error instanceof Error ? error.message : String(error)}`));
  }

  if (event.type === "status") console.log(`Fingerprint reader ${event.online ? "online" : "offline"}`);
  if (event.type === "error") console.error(event.message);
});

setInterval(() => {
  sync.flushPending().catch((error) => console.log(`Periodic sync failed: ${error instanceof Error ? error.message : String(error)}`));
}, 30_000);

bridge.start(config.pythonPath, config.fingerprintBridgePath);
