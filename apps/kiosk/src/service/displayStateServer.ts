import { createServer, type Server } from "node:http";
import type { KioskScanAcknowledgement, KioskSyncResult } from "@frc-attendance/shared";
import { baseDisplayState, type KioskDisplayState, type KioskStateId } from "../kioskStates";

export type { DisplayStatus, KioskDisplayState, KioskStateId } from "../kioskStates";

export class DisplayStateServer {
  private state: KioskDisplayState = withTimestamp(baseDisplayState("ready"));

  private server?: Server;

  current(): KioskDisplayState {
    return this.state;
  }

  start(port: number): void {
    if (this.server) return;
    this.server = createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders());
        response.end();
        return;
      }

      if (request.method === "GET" && request.url === "/kiosk/display-state") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders()
        });
        response.end(JSON.stringify(this.state));
        return;
      }

      response.writeHead(404, {
        "content-type": "application/json; charset=utf-8",
        ...corsHeaders()
      });
      response.end(JSON.stringify({ error: "Not found" }));
    });

    this.server.listen(port, "0.0.0.0", () => {
      console.log(`Kiosk display state server listening on http://localhost:${port}`);
    });
  }

  setProcessing(detail?: string): void {
    this.set({
      ...baseDisplayState("processing"),
      detail: detail ?? baseDisplayState("processing").detail
    });
  }

  setAcknowledgement(acknowledgement: KioskScanAcknowledgement): void {
    this.set(displayStateForAcknowledgement(acknowledgement));
  }

  setSyncResult(localEventId: string, studentId: string, result: KioskSyncResult): void {
    const accepted = result.accepted.find((event) => event.localEventId === localEventId);
    if (accepted) {
      this.set({
        status: "welcome",
        message: "Scan accepted",
        detail: `Member ${studentId}`
      });
      return;
    }

    const duplicate = result.duplicates.find((event) => event.localEventId === localEventId);
    if (duplicate) {
      this.set({
        status: "duplicate",
        message: "Already recorded",
        detail: `Member ${studentId}`
      });
      return;
    }

    const rejected = result.rejected.find((event) => event.localEventId === localEventId);
    if (rejected) {
      this.set({
        status: "rejected",
        message: "Scan rejected",
        detail: rejected.reason
      });
    }
  }

  setUnknownFingerprint(): void {
    this.set(baseDisplayState("unknown"));
  }

  setOffline(message: string): void {
    this.set({
      ...baseDisplayState("offline"),
      detail: message
    });
  }

  setReaderOffline(): void {
    this.set(baseDisplayState("reader_offline"));
  }

  setState(status: KioskStateId, detail?: string): void {
    this.set({
      ...baseDisplayState(status),
      detail: detail ?? baseDisplayState(status).detail
    });
  }

  private set(state: Omit<KioskDisplayState, "updatedAt">): void {
    this.state = withTimestamp(state);
  }
}

export function displayStateForAcknowledgement(acknowledgement: KioskScanAcknowledgement): Omit<KioskDisplayState, "updatedAt"> {
  if (acknowledgement.status === "duplicate") {
    return {
      status: "duplicate",
      message: baseDisplayState("duplicate").message,
      detail: acknowledgement.displayName ?? `Member ${acknowledgement.studentId}`
    };
  }

  if (acknowledgement.status === "rejected") {
    return {
      status: "rejected",
      message: baseDisplayState("rejected").message,
      detail: acknowledgement.message
    };
  }

  return {
    status: acknowledgement.action === "check_out" ? "goodbye" : "welcome",
    message: baseDisplayState(acknowledgement.action === "check_out" ? "goodbye" : "welcome").message,
    detail: [acknowledgement.displayName ?? `Member ${acknowledgement.studentId}`, acknowledgement.attendanceSummary].filter(Boolean).join(" - ")
  };
}

function withTimestamp(state: Omit<KioskDisplayState, "updatedAt">): KioskDisplayState {
  return { ...state, updatedAt: new Date().toISOString() };
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
