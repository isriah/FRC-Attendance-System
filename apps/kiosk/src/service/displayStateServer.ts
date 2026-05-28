import { createServer, type Server } from "node:http";
import type { KioskScanAcknowledgement } from "@frc-attendance/shared";

export type DisplayStatus = "ready" | "syncing" | "welcome" | "goodbye" | "duplicate" | "rejected" | "unknown" | "offline";

export interface KioskDisplayState {
  status: DisplayStatus;
  message: string;
  detail: string;
  updatedAt: string;
}

export class DisplayStateServer {
  private state: KioskDisplayState = withTimestamp({
    status: "ready",
    message: "Place finger on reader",
    detail: "Attendance kiosk ready"
  });

  private server?: Server;

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

  setSyncing(studentId: string): void {
    this.set({
      status: "syncing",
      message: "Checking scan",
      detail: `Member ${studentId}`
    });
  }

  setAcknowledgement(acknowledgement: KioskScanAcknowledgement): void {
    this.set(displayStateForAcknowledgement(acknowledgement));
  }

  setUnknownFingerprint(): void {
    this.set({
      status: "unknown",
      message: "Fingerprint not recognized",
      detail: "Try again or ask a mentor for help."
    });
  }

  setOffline(message: string): void {
    this.set({
      status: "offline",
      message: "Connection offline",
      detail: message
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
      message: "Already recorded",
      detail: acknowledgement.displayName ?? `Member ${acknowledgement.studentId}`
    };
  }

  if (acknowledgement.status === "rejected") {
    return {
      status: "rejected",
      message: "Scan rejected",
      detail: acknowledgement.message
    };
  }

  return {
    status: acknowledgement.action === "check_out" ? "goodbye" : "welcome",
    message: acknowledgement.action === "check_out" ? "Goodbye" : "Welcome",
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
