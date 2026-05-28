import { describe, expect, it } from "vitest";
import { requireKioskCommandAction } from "../src/kioskCommands";

describe("kiosk command validation", () => {
  it("accepts allowlisted kiosk command actions", () => {
    expect(requireKioskCommandAction("restart_display")).toBe("restart_display");
    expect(requireKioskCommandAction("restart_services")).toBe("restart_services");
    expect(requireKioskCommandAction("reboot_system")).toBe("reboot_system");
  });

  it("rejects unsupported kiosk command actions", () => {
    expect(() => requireKioskCommandAction("run_anything")).toThrow("Unsupported kiosk command action");
  });
});
