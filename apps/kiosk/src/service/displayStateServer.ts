import { createServer, type Server } from "node:http";
import type { KioskScanAcknowledgement, KioskSyncResult } from "@frc-attendance/shared";
import { baseDisplayState, type KioskDisplayState, type KioskStateId } from "../kioskStates";
import { createNetworkManager, type NetworkManager } from "./networkManager";
import { configureNetworkPin, hasNetworkPin, verifyNetworkPin } from "./networkPin";

export type { DisplayStatus, KioskDisplayState, KioskStateId } from "../kioskStates";

export interface KioskDisplayHealth {
  readerOnline?: boolean | null;
  pendingScanCount: number;
  lastSyncAt?: string;
  lastSyncError?: string;
}

export class DisplayStateServer {
  private state: KioskDisplayState = withTimestamp(baseDisplayState("ready"));

  private health: KioskDisplayHealth = { pendingScanCount: 0 };

  private server?: Server;

  private failedPinAttempts = 0;

  private pinRetryAvailableAt = 0;

  constructor(
    private readonly network: NetworkManager = createNetworkManager(),
    private readonly networkPinPath = "./kiosk-cache.sqlite.network-pin.json"
  ) {}

  current(): KioskDisplayState & { health: KioskDisplayHealth } {
    return { ...this.state, health: this.health };
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
        response.end(JSON.stringify(this.current()));
        return;
      }

      if (request.method === "GET" && request.url === "/kiosk/network-status") {
        void this.respondJson(response, () => this.network.status());
        return;
      }

      if (request.method === "GET" && request.url === "/kiosk/network-pin-status") {
        void this.respondJson(response, async () => ({ configured: await hasNetworkPin(this.networkPinPath) }));
        return;
      }

      if (request.method === "POST" && request.url === "/kiosk/network-pin/configure") {
        void this.configureNetworkPin(request, response);
        return;
      }

      if (request.method === "POST" && request.url === "/kiosk/network-pin/verify") {
        void this.verifyNetworkPin(request, response);
        return;
      }

      if (request.method === "GET" && request.url === "/kiosk/wifi-networks") {
        void this.respondJson(response, () => this.network.listWifi());
        return;
      }

      if (request.method === "POST" && request.url === "/kiosk/wifi-connect") {
        void this.connectWifi(request, response);
        return;
      }

      response.writeHead(404, {
        "content-type": "application/json; charset=utf-8",
        ...corsHeaders()
      });
      response.end(JSON.stringify({ error: "Not found" }));
    });

    this.server.listen(port, "127.0.0.1", () => {
      console.log(`Kiosk display state server listening on http://localhost:${port}`);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
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

  setSyncResult(localEventId: string, memberId: string, result: KioskSyncResult): void {
    const accepted = result.accepted.find((event) => event.localEventId === localEventId);
    if (accepted) {
      this.set({
        status: "welcome",
        message: "Scan saved",
        detail: `${memberIdLabel(memberId)} recorded.`
      });
      return;
    }

    const duplicate = result.duplicates.find((event) => event.localEventId === localEventId);
    if (duplicate) {
      this.set({
        status: "duplicate",
        message: "Already recorded",
        detail: `${memberIdLabel(memberId)} was already recorded. Attendance was not changed.`
      });
      return;
    }

    const rejected = result.rejected.find((event) => event.localEventId === localEventId);
    if (rejected) {
      this.set({
        status: "rejected",
        message: "Scan needs help",
        detail: rejectionDetail(memberId, rejected.reason)
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

  setHealth(health: KioskDisplayHealth): void {
    this.health = health;
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

  private async respondJson(response: import("node:http").ServerResponse, action: () => Promise<unknown>): Promise<void> {
    try {
      const body = await action();
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
      response.end(JSON.stringify(body));
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Network setup is unavailable" }));
    }
  }

  private async connectWifi(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
    let raw = "";
    request.setEncoding("utf8");
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 8_192) {
        response.writeHead(413, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
        response.end(JSON.stringify({ error: "Network request is too large" }));
        return;
      }
    }
    try {
      const input = JSON.parse(raw) as { ssid?: unknown; password?: unknown };
      if (typeof input.ssid !== "string" || typeof input.password !== "string") throw new Error("Choose a network and enter its password if required.");
      await this.network.connectWifi(input.ssid, input.password);
      response.writeHead(204, corsHeaders());
      response.end();
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not join the Wi-Fi network" }));
    }
  }

  private async configureNetworkPin(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
    try {
      const input = await this.readPinRequest(request);
      if (await hasNetworkPin(this.networkPinPath)) throw new Error("A network settings PIN is already configured.");
      await configureNetworkPin(this.networkPinPath, input.pin, input.confirmation);
      if (!await verifyNetworkPin(this.networkPinPath, input.pin)) throw new Error("The new PIN could not be verified. Try again.");
      response.writeHead(204, corsHeaders());
      response.end();
    } catch (error) {
      this.respondPinError(response, error);
    }
  }

  private async verifyNetworkPin(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
    try {
      const input = await this.readPinRequest(request);
      if (!await hasNetworkPin(this.networkPinPath)) throw new Error("Set a network settings PIN first.");
      if (Date.now() < this.pinRetryAvailableAt) throw new Error("Try the network settings PIN again in a moment.");
      if (!await verifyNetworkPin(this.networkPinPath, input.pin)) {
        this.failedPinAttempts += 1;
        if (this.failedPinAttempts >= 5) {
          this.failedPinAttempts = 0;
          this.pinRetryAvailableAt = Date.now() + 30_000;
          throw new Error("Too many incorrect PIN attempts. Try again in 30 seconds.");
        }
        throw new Error("That PIN is incorrect. Try again.");
      }
      this.failedPinAttempts = 0;
      this.pinRetryAvailableAt = 0;
      response.writeHead(204, corsHeaders());
      response.end();
    } catch (error) {
      this.respondPinError(response, error);
    }
  }

  private async readPinRequest(request: import("node:http").IncomingMessage): Promise<{ pin?: unknown; confirmation?: unknown }> {
    let raw = "";
    request.setEncoding("utf8");
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 1_024) throw new Error("PIN request is too large");
    }
    return JSON.parse(raw) as { pin?: unknown; confirmation?: unknown };
  }

  private respondPinError(response: import("node:http").ServerResponse, error: unknown): void {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "The network PIN could not be verified." }));
  }
}

export function displayStateForAcknowledgement(acknowledgement: KioskScanAcknowledgement): Omit<KioskDisplayState, "updatedAt"> {
  if (acknowledgement.status === "duplicate") {
    return {
      status: "duplicate",
      message: acknowledgement.kioskMessage ?? baseDisplayState("duplicate").message,
      detail: acknowledgement.kioskDetail ?? acknowledgement.displayName ?? `Member ${acknowledgement.memberId}`
    };
  }

  if (acknowledgement.status === "rejected") {
    return {
      status: "rejected",
      message: acknowledgement.kioskMessage ?? baseDisplayState("rejected").message,
      detail: acknowledgement.kioskDetail ?? acknowledgement.message
    };
  }

  return {
    status: acknowledgement.action === "check_out" ? "goodbye" : "welcome",
    message: acknowledgement.kioskMessage ?? baseDisplayState(acknowledgement.action === "check_out" ? "goodbye" : "welcome").message,
    detail: acknowledgement.kioskDetail ?? [acknowledgement.displayName ?? memberIdLabel(acknowledgement.memberId), acknowledgement.attendanceSummary].filter(Boolean).join(" - ")
  };
}

function memberIdLabel(memberId: string): string {
  return `Member ID ${memberId}`;
}

function rejectionDetail(memberId: string, reason: string): string {
  if (reason === "member is not active in roster" || reason === "student is not active in roster") {
    return `${memberIdLabel(memberId)} is not active. Ask a mentor for help.`;
  }
  return `${memberIdLabel(memberId)} could not be accepted. Ask a mentor for help.`;
}

function withTimestamp(state: Omit<KioskDisplayState, "updatedAt">): KioskDisplayState {
  return { ...state, updatedAt: new Date().toISOString() };
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
