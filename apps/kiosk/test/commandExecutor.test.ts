import { describe, expect, it } from "vitest";
import { commandLabel } from "../src/service/commandExecutor";

describe("kiosk command labels", () => {
  it("labels allowed restart commands", () => {
    expect(commandLabel("restart_display")).toBe("Restart browser display");
    expect(commandLabel("restart_services")).toBe("Restart kiosk services");
    expect(commandLabel("reboot_system")).toBe("Reboot system");
  });
});
