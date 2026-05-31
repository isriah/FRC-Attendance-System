import { describe, expect, it } from "vitest";
import { parseBridgeLine } from "../src/service/fingerprintBridge";

describe("fingerprint bridge parser", () => {
  it("parses status messages", () => {
    expect(parseBridgeLine("STAT:ONLINE")).toEqual({ type: "status", online: true });
  });

  it("parses semantic state messages", () => {
    expect(parseBridgeLine("STATE:processing")).toEqual({ type: "state", state: "processing" });
  });

  it("parses fingerprint matches", () => {
    expect(parseBridgeLine("MATCH:100001,7")).toEqual({ type: "match", studentId: "100001", templateSlot: 7 });
  });
});
