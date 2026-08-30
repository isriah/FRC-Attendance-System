import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseDisplayState } from "../src/kioskStates";
import { DisplayStateServer, displayStateForAcknowledgement } from "../src/service/displayStateServer";

describe("display state acknowledgements", () => {
  it("shows accepted check-ins as welcome messages", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-1",
      memberId: "100001",
      status: "accepted",
      action: "check_in",
      displayName: "Bench Student",
      attendanceSummary: "Attendance 100% (1/1)",
      kioskMessage: "Welcome, Bench Student",
      kioskDetail: "Checked in at 3:00 PM. Attendance 100% (1/1)",
      message: "Welcome, Bench Student"
    })).toEqual({
      status: "welcome",
      message: "Welcome, Bench Student",
      detail: "Checked in at 3:00 PM. Attendance 100% (1/1)"
    });
  });

  it("shows duplicate scans without changing attendance action", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-2",
      memberId: "100001",
      status: "duplicate",
      displayName: "Bench Student",
      kioskMessage: "Already recorded",
      kioskDetail: "Bench Student, your attendance was already recorded. Please wait a moment before scanning again.",
      message: "Bench Student was already recorded."
    })).toEqual({
      status: "duplicate",
      message: "Already recorded",
      detail: "Bench Student, your attendance was already recorded. Please wait a moment before scanning again."
    });
  });

  it("shows accepted check-outs as goodbye messages", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-out",
      memberId: "1234",
      status: "accepted",
      action: "check_out",
      displayName: "Test Person",
      attendanceSummary: "Attendance 100% (1/1)",
      kioskMessage: "Goodbye, Test Person",
      kioskDetail: "Checked out at 5:00 PM. Attendance 100% (1/1)",
      message: "Goodbye, Test Person"
    })).toEqual({
      status: "goodbye",
      message: "Goodbye, Test Person",
      detail: "Checked out at 5:00 PM. Attendance 100% (1/1)"
    });
  });

  it("shows rejected scans with the acknowledgement message", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-rejected",
      memberId: "qa-inactive",
      status: "rejected",
      kioskMessage: "Roster issue",
      kioskDetail: "Member ID qa-inactive, this Member ID is not active. Ask a mentor for help.",
      message: "this Member ID is not active. Ask a mentor for help."
    })).toEqual({
      status: "rejected",
      message: "Roster issue",
      detail: "Member ID qa-inactive, this Member ID is not active. Ask a mentor for help."
    });
  });

  it("falls back to locally composed acknowledgement messages for older APIs", () => {
    expect(displayStateForAcknowledgement({
      localEventId: "local-old",
      memberId: "100001",
      status: "accepted",
      action: "check_in",
      displayName: "Bench Student",
      attendanceSummary: "Attendance 100% (1/1)",
      message: "Welcome, Bench Student"
    })).toEqual({
      status: "welcome",
      message: "Welcome",
      detail: "Bench Student - Attendance 100% (1/1)"
    });
  });

  it("falls back to member IDs when the sync result has no acknowledgement", () => {
    const server = new DisplayStateServer();
    server.setSyncResult("local-3", "100001", {
      accepted: [{
        id: "bench-01:local-3",
        kioskId: "bench-01",
        localEventId: "local-3",
        memberId: "100001",
        occurredAt: new Date().toISOString(),
        source: "fingerprint",
        status: "accepted"
      }],
      duplicates: [],
      rejected: []
    });

    expect(server.current()).toMatchObject({
      status: "welcome",
      message: "Scan saved",
      detail: "Member ID 100001 recorded."
    });
  });

  it("uses human-friendly fallback copy for duplicate and rejected sync results", () => {
    const server = new DisplayStateServer();

    server.setSyncResult("local-duplicate", "100001", {
      accepted: [],
      duplicates: [{
        id: "bench-01:local-duplicate",
        kioskId: "bench-01",
        localEventId: "local-duplicate",
        memberId: "100001",
        occurredAt: new Date().toISOString(),
        source: "fingerprint",
        status: "duplicate"
      }],
      rejected: []
    });

    expect(server.current()).toMatchObject({
      status: "duplicate",
      message: "Already recorded",
      detail: "Member ID 100001 was already recorded. Attendance was not changed."
    });

    server.setSyncResult("local-rejected", "100002", {
      accepted: [],
      duplicates: [],
      rejected: [{
        localEventId: "local-rejected",
        memberId: "100002",
        occurredAt: new Date().toISOString(),
        source: "fingerprint",
        reason: "member is not active in roster"
      }]
    });

    expect(server.current()).toMatchObject({
      status: "rejected",
      message: "Scan needs help",
      detail: "Member ID 100002 is not active. Ask a mentor for help."
    });
  });

  it("uses shared base states for transient service statuses", () => {
    const server = new DisplayStateServer();

    server.setProcessing();
    expect(server.current()).toMatchObject(baseDisplayState("processing"));

    server.setUnknownFingerprint();
    expect(server.current()).toMatchObject(baseDisplayState("unknown"));

    server.setOffline(baseDisplayState("offline").detail);
    expect(server.current()).toMatchObject(baseDisplayState("offline"));

    server.setReaderOffline();
    expect(server.current()).toMatchObject(baseDisplayState("reader_offline"));
  });

  it("includes kiosk health in the display state payload", () => {
    const server = new DisplayStateServer();
    const displayUpdatedAt = server.current().updatedAt;

    server.setHealth({
      readerOnline: true,
      pendingScanCount: 2,
      lastSyncError: "Sync failed"
    });

    expect(server.current()).toMatchObject({
      health: {
        readerOnline: true,
        pendingScanCount: 2,
        lastSyncError: "Sync failed"
      }
    });
    expect(server.current().updatedAt).toBe(displayUpdatedAt);
  });

  it("serves kiosk health from the display state endpoint", async () => {
    const server = new DisplayStateServer();
    const port = 18988;

    server.setHealth({
      readerOnline: false,
      pendingScanCount: 1,
      lastSyncError: "offline"
    });
    server.start(port);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/kiosk/display-state`);
      expect(await response.json()).toMatchObject({
        health: {
          readerOnline: false,
          pendingScanCount: 1,
          lastSyncError: "offline"
        }
      });
    } finally {
      server.stop();
    }
  });

  it("requires a short-lived verified PIN session for manual Wi-Fi endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frc-network-session-"));
    const port = 18989;
    const server = new DisplayStateServer({
      status: async () => ({ connected: true }),
      listWifi: async () => [{ ssid: "Team WiFi", secured: true, active: false }],
      connectWifi: async () => undefined
    }, join(directory, "network-pin.json"));
    server.start(port);

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      expect((await fetch(`${baseUrl}/kiosk/wifi-networks`)).status).toBe(403);
      expect((await fetch(`${baseUrl}/kiosk/wifi-networks`, { headers: { "x-frc-network-offline-bootstrap": "1" } })).status).toBe(403);

      const preflight = await fetch(`${baseUrl}/kiosk/wifi-networks`, {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "GET",
          "access-control-request-headers": "x-frc-network-session, x-frc-network-offline-bootstrap"
        }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-headers")).toContain("x-frc-network-session");
      expect(preflight.headers.get("access-control-allow-headers")).toContain("x-frc-network-offline-bootstrap");

      const setup = await fetch(`${baseUrl}/kiosk/network-pin/configure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: "123456", confirmation: "123456" })
      });
      expect(setup.status).toBe(200);
      const { networkSession } = await setup.json() as { networkSession: string };
      expect(networkSession).toEqual(expect.any(String));

      const authorized = await fetch(`${baseUrl}/kiosk/wifi-networks`, { headers: { "x-frc-network-session": networkSession } });
      expect(authorized.status).toBe(200);
      expect(await authorized.json()).toEqual([{ ssid: "Team WiFi", secured: true, active: false }]);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrongPin = await fetch(`${baseUrl}/kiosk/network-pin/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pin: "654321" })
        });
        expect(wrongPin.status).toBe(400);
        if (attempt === 4) expect(await wrongPin.text()).toContain("Too many incorrect PIN attempts");
      }

      const cooledDown = await fetch(`${baseUrl}/kiosk/network-pin/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: "123456" })
      });
      expect(cooledDown.status).toBe(400);
      expect(await cooledDown.text()).toContain("Try the network settings PIN again in a moment");
    } finally {
      server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("expires verified PIN sessions after five minutes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frc-network-session-expiry-"));
    const port = 18990;
    const server = new DisplayStateServer({
      status: async () => ({ connected: true }),
      listWifi: async () => [],
      connectWifi: async () => undefined
    }, join(directory, "network-pin.json"));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    server.start(port);

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const setup = await fetch(`${baseUrl}/kiosk/network-pin/configure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: "123456", confirmation: "123456" })
      });
      const { networkSession } = await setup.json() as { networkSession: string };
      now.mockReturnValue(1_300_001);

      const expired = await fetch(`${baseUrl}/kiosk/wifi-networks`, { headers: { "x-frc-network-session": networkSession } });
      expect(expired.status).toBe(403);
    } finally {
      now.mockRestore();
      server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows PIN-free Wi-Fi recovery only while the kiosk is offline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frc-network-offline-bootstrap-"));
    const port = 18991;
    const server = new DisplayStateServer({
      status: async () => ({ connected: false }),
      listWifi: async () => [{ ssid: "Recovery WiFi", secured: true, active: false }],
      connectWifi: async () => undefined
    }, join(directory, "network-pin.json"));
    server.start(port);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/kiosk/wifi-networks`, {
        headers: { "x-frc-network-offline-bootstrap": "1" }
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([{ ssid: "Recovery WiFi", secured: true, active: false }]);
    } finally {
      server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
