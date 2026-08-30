import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configureNetworkPin, hasNetworkPin, resetNetworkPin, validateNetworkPin, verifyNetworkPin } from "../src/service/networkPin";

describe("local network settings PIN", () => {
  it("stores a salted verifier instead of the PIN and verifies it locally", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frc-network-pin-"));
    const path = join(directory, "network-pin.json");
    try {
      await configureNetworkPin(path, "123456", "123456");
      expect(await hasNetworkPin(path)).toBe(true);
      expect(await verifyNetworkPin(path, "123456")).toBe(true);
      expect(await verifyNetworkPin(path, "654321")).toBe(false);
      const stored = await readFile(path, "utf8");
      expect(stored).not.toContain("123456");
      expect(JSON.parse(stored)).toMatchObject({ version: 1, algorithm: "scrypt" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires a matching 6 to 12 digit PIN and supports reset", async () => {
    expect(() => validateNetworkPin("12345")).toThrow("6 to 12 digits");
    expect(() => validateNetworkPin("1234ab")).toThrow("6 to 12 digits");
    const directory = await mkdtemp(join(tmpdir(), "frc-network-pin-"));
    const path = join(directory, "network-pin.json");
    try {
      await expect(configureNetworkPin(path, "123456", "654321")).rejects.toThrow("do not match");
      await configureNetworkPin(path, "123456", "123456");
      await resetNetworkPin(path);
      expect(await hasNetworkPin(path)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
