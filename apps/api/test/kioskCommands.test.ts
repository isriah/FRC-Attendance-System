import { describe, expect, it } from "vitest";
import { requireKioskCommandAction, requireKioskCommandPermission } from "../src/kioskCommands";

describe("kiosk command validation", () => {
  it("accepts allowlisted kiosk command actions", () => {
    expect(requireKioskCommandAction("restart_display")).toBe("restart_display");
    expect(requireKioskCommandAction("restart_services")).toBe("restart_services");
    expect(requireKioskCommandAction("reboot_system")).toBe("reboot_system");
    expect(requireKioskCommandAction("reset_network_settings_pin")).toBe("reset_network_settings_pin");
  });

  it("rejects unsupported kiosk command actions", () => {
    expect(() => requireKioskCommandAction("run_anything")).toThrow("Unsupported kiosk command action");
  });

  it("restricts network PIN reset commands to administrators", () => {
    expect(() => requireKioskCommandPermission("reset_network_settings_pin", "mentor")).toThrow("Only administrators");
    expect(() => requireKioskCommandPermission("reset_network_settings_pin", "admin")).not.toThrow();
    expect(() => requireKioskCommandPermission("restart_display", "mentor")).not.toThrow();
  });
});
