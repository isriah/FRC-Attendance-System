import { describe, expect, it } from "vitest";
import { kioskCommandHistoryToggleLabel, olderKioskCommandCount, visibleKioskCommands, type KioskCommandRow } from "./kioskCommands";

const commands: KioskCommandRow[] = [
  { id: "newest", kioskId: "kiosk-a", action: "restart_display", status: "completed", requestedAt: "2026-08-30T15:00:00.000Z" },
  { id: "older-one", kioskId: "kiosk-a", action: "restart_services", status: "failed", requestedAt: "2026-08-30T14:00:00.000Z", message: "Service unavailable" },
  { id: "older-two", kioskId: "kiosk-a", action: "reboot_system", status: "pending", requestedAt: "2026-08-30T13:00:00.000Z" }
];

describe("kiosk command history", () => {
  it("keeps only the newest command visible until expanded", () => {
    expect(visibleKioskCommands(commands, false).map((command) => command.id)).toEqual(["newest"]);
    expect(visibleKioskCommands(commands, true)).toEqual(commands);
  });

  it("provides clear singular and plural expand/collapse labels", () => {
    expect(olderKioskCommandCount(commands)).toBe(2);
    expect(kioskCommandHistoryToggleLabel(commands, false)).toBe("Show 2 older commands");
    expect(kioskCommandHistoryToggleLabel(commands, true)).toBe("Hide 2 older commands");
    expect(kioskCommandHistoryToggleLabel(commands.slice(0, 2), false)).toBe("Show 1 older command");
    expect(kioskCommandHistoryToggleLabel(commands.slice(0, 1), false)).toBe("");
  });
});
