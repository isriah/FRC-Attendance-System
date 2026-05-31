import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { kioskStates, type KioskStateId } from "../kioskStates";

export type FingerprintBridgeEvent =
  | { type: "status"; online: boolean }
  | { type: "state"; state: KioskStateId }
  | { type: "match"; studentId: string; templateSlot: number }
  | { type: "no-match" }
  | { type: "error"; message: string };

export class FingerprintBridge extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;

  start(pythonPath: string, bridgePath: string) {
    const child = spawn(pythonPath, [bridgePath], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        this.emit("bridge-event", parseBridgeLine(line));
      }
    });

    child.stderr.on("data", (chunk) => {
      this.emit("bridge-event", { type: "error", message: chunk.toString() } satisfies FingerprintBridgeEvent);
    });

    child.on("exit", (code) => {
      if (this.child === child) this.child = undefined;
      this.emit("bridge-event", { type: "error", message: `fingerprint bridge exited with code ${code}` } satisfies FingerprintBridgeEvent);
      setTimeout(() => this.start(pythonPath, bridgePath), 2000);
    });
  }

  setLedState(state: KioskStateId): void {
    if (!this.child || this.child.stdin.destroyed) return;
    this.child.stdin.write(`LED_STATE:${state}\n`);
  }
}

export function parseBridgeLine(line: string): FingerprintBridgeEvent {
  const [type, ...rest] = line.split(":");
  const value = rest.join(":");
  if (type === "STAT") return { type: "status", online: value === "ONLINE" };
  if (type === "STATE") {
    if (Object.hasOwn(kioskStates, value)) return { type: "state", state: value as KioskStateId };
    return { type: "error", message: `unknown kiosk state: ${value}` };
  }
  if (type === "MATCH") {
    const [studentId, slot] = value.split(",");
    if (!studentId || !slot) return { type: "error", message: `invalid match line: ${line}` };
    return { type: "match", studentId, templateSlot: Number(slot) };
  }
  if (type === "NO_MATCH") return { type: "no-match" };
  return { type: "error", message: `unknown bridge line: ${line}` };
}
