import { describe, expect, it } from "vitest";
import { kioskStates, type KioskStateId } from "../src/kioskStates";

const requiredStates: KioskStateId[] = [
  "ready",
  "processing",
  "welcome",
  "goodbye",
  "duplicate",
  "rejected",
  "unknown",
  "offline",
  "reader_offline",
  "enroll_wait_first",
  "enroll_wait_second",
  "enroll_scan_accepted",
  "enroll_success",
  "enroll_failure"
];

describe("kiosk semantic states", () => {
  it("defines all required operational states", () => {
    expect(Object.keys(kioskStates)).toEqual(expect.arrayContaining(requiredStates));
  });

  it("gives every state display copy and valid LED behavior", () => {
    for (const [stateId, state] of Object.entries(kioskStates)) {
      expect(state.display.message, stateId).toBeTruthy();
      expect(state.display.detail, stateId).toBeTruthy();
      expect(["red", "blue", "purple"]).toContain(state.led.color);
      expect(["breathe", "flash", "on", "off"]).toContain(state.led.mode);
      expect(state.led.speed).toBeGreaterThan(0);
      expect(state.led.cycles).toBeGreaterThanOrEqual(0);
    }
  });

  it("only returns LEDs to existing states", () => {
    for (const state of Object.values(kioskStates)) {
      if ("returnTo" in state.led) expect(kioskStates).toHaveProperty(state.led.returnTo);
    }
  });
});
