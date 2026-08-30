import { describe, expect, it } from "vitest";
import { parseNetworkStatus, parseWifiNetworks } from "../src/service/networkManager";

describe("NetworkManager parsing", () => {
  it("recognizes an active Wi-Fi or wired connection", () => {
    expect(parseNetworkStatus("lo:loopback:connected (externally):lo\nwlan0:wifi:connected:Team WiFi")).toEqual({
      connected: true,
      device: "wlan0",
      type: "wifi",
      connection: "Team WiFi"
    });
    expect(parseNetworkStatus("wlan0:wifi:disconnected:\neth0:ethernet:disconnected:")).toEqual({ connected: false });
  });

  it("deduplicates and orders nearby Wi-Fi networks without exposing their passwords", () => {
    expect(parseWifiNetworks("Team\\: WiFi:75:WPA2:*\nGuest:22::\nTeam\\: WiFi:40:WPA2:")).toEqual([
      { ssid: "Team: WiFi", signal: 75, secured: true, active: true },
      { ssid: "Guest", signal: 22, secured: false, active: false }
    ]);
  });
});
