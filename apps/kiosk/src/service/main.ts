import { executeKioskCommand, commandLabel } from "./commandExecutor";
import { loadConfig } from "./config";
import { DisplayStateServer } from "./displayStateServer";
import { FingerprintBridge, type FingerprintBridgeEvent } from "./fingerprintBridge";
import { ledStateForAcknowledgement, ledStateForSyncResult } from "./kioskStateDecisions";
import { OfflineQueue } from "./offlineQueue";
import { SyncClient } from "./syncClient";

const config = loadConfig();
const queue = new OfflineQueue(config.databasePath);
const sync = new SyncClient(config, queue);
const bridge = new FingerprintBridge();
const display = new DisplayStateServer();
const health = {
  readerOnline: null as boolean | null,
  lastSyncAt: undefined as string | undefined,
  lastSyncError: undefined as string | undefined
};

display.start(config.displayStatePort);

bridge.on("bridge-event", async (event: FingerprintBridgeEvent) => {
  if (event.type === "match") {
    const local = queue.addFingerprintScan(event.studentId);
    display.setProcessing(`Member ${event.studentId}`);
    console.log(`Queued scan ${local.localEventId} for student ${event.studentId}`);
    try {
      const result = await sync.flushPending();
      const acknowledgement = result?.acknowledgements?.find((ack) => ack.localEventId === local.localEventId);
      if (acknowledgement) {
        display.setAcknowledgement(acknowledgement);
        bridge.setLedState(ledStateForAcknowledgement(acknowledgement));
        console.log(`Scan acknowledged: ${acknowledgement.message}`);
      } else if (result) {
        display.setSyncResult(local.localEventId, event.studentId, result);
        const ledState = ledStateForSyncResult(local.localEventId, result);
        if (ledState) bridge.setLedState(ledState);
      }
      console.log("Synced pending scans");
      health.lastSyncAt = new Date().toISOString();
      health.lastSyncError = undefined;
      reportHealth();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      health.lastSyncError = message;
      display.setOffline("Scan saved locally and will sync when the connection returns.");
      bridge.setLedState("offline");
      console.log(`Offline or sync failed; scan remains cached: ${message}`);
      reportHealth();
    }
  }

  if (event.type === "no-match") {
    display.setUnknownFingerprint();
    bridge.setLedState("unknown");
    console.log("Fingerprint was not recognized");
    sync.reportNoMatch().catch((error) => console.log(`Could not report unknown fingerprint: ${error instanceof Error ? error.message : String(error)}`));
  }

  if (event.type === "state") display.setState(event.state);
  if (event.type === "status") {
    health.readerOnline = event.online;
    if (event.online) display.setState("ready");
    else display.setReaderOffline();
    console.log(`Fingerprint reader ${event.online ? "online" : "offline"}`);
    reportHealth();
  }
  if (event.type === "error") console.error(event.message);
});

setInterval(() => {
  sync.flushPending().then((result) => {
    if (result) {
      health.lastSyncAt = new Date().toISOString();
      health.lastSyncError = undefined;
    }
    reportHealth();
  }).catch((error) => {
    health.lastSyncError = error instanceof Error ? error.message : String(error);
    console.log(`Periodic sync failed: ${health.lastSyncError}`);
    reportHealth();
  });
}, 30_000);

function reportHealth() {
  sync.reportHealth(health).catch((error) => {
    console.log(`Health report failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function pollCommands() {
  const commands = await sync.fetchCommands();
  for (const command of commands) {
    const label = commandLabel(command.action);
    console.log(`Running kiosk command ${command.id}: ${label}`);
    try {
      const message = await executeKioskCommand(command, config);
      await sync.completeCommand(command.id, "completed", message);
      console.log(`Completed kiosk command ${command.id}: ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sync.completeCommand(command.id, "failed", message).catch((completionError) => {
        console.log(`Could not report failed command ${command.id}: ${completionError instanceof Error ? completionError.message : String(completionError)}`);
      });
      console.log(`Kiosk command ${command.id} failed: ${message}`);
    }
  }
}

setInterval(() => {
  pollCommands().catch((error) => console.log(`Command poll failed: ${error instanceof Error ? error.message : String(error)}`));
}, config.commandPollSeconds * 1000);

pollCommands().catch((error) => console.log(`Initial command poll failed: ${error instanceof Error ? error.message : String(error)}`));

reportHealth();
setInterval(reportHealth, 15_000);

bridge.start(config.pythonPath, config.fingerprintBridgePath);
