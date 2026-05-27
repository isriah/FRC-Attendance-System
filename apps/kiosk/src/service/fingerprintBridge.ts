import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export type FingerprintBridgeEvent =
  | { type: "status"; online: boolean }
  | { type: "match"; studentId: string; templateSlot: number }
  | { type: "error"; message: string };

export class FingerprintBridge extends EventEmitter {
  start(pythonPath: string, bridgePath: string) {
    const child = spawn(pythonPath, [bridgePath], { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        this.emit("bridge-event", parseBridgeLine(line));
      }
    });

    child.stderr.on("data", (chunk) => {
      this.emit("bridge-event", { type: "error", message: chunk.toString() } satisfies FingerprintBridgeEvent);
    });

    child.on("exit", (code) => {
      this.emit("bridge-event", { type: "error", message: `fingerprint bridge exited with code ${code}` } satisfies FingerprintBridgeEvent);
      setTimeout(() => this.start(pythonPath, bridgePath), 2000);
    });
  }
}

export function parseBridgeLine(line: string): FingerprintBridgeEvent {
  const [type, ...rest] = line.split(":");
  const value = rest.join(":");
  if (type === "STAT") return { type: "status", online: value === "ONLINE" };
  if (type === "MATCH") {
    const [studentId, slot] = value.split(",");
    if (!studentId || !slot) return { type: "error", message: `invalid match line: ${line}` };
    return { type: "match", studentId, templateSlot: Number(slot) };
  }
  return { type: "error", message: `unknown bridge line: ${line}` };
}
