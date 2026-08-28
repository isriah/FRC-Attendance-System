import { describe, expect, it } from "vitest";
import { fingerprintEnrollmentName, nextAvailableFingerprintSlot, normalizeFingerLabel, type FingerprintEnrollment } from "./fingerprintEnrollment";

function enrollment(slot: number, memberId = `10000${slot}`): FingerprintEnrollment {
  return {
    memberId,
    active: 1,
    slot,
    enrolledAt: "2026-05-28T15:00:00.000Z"
  };
}

describe("fingerprint enrollment helpers", () => {
  it("suggests the first unoccupied sensor slot", () => {
    expect(nextAvailableFingerprintSlot([enrollment(1), enrollment(3)])).toBe(2);
  });

  it("skips a newly written slot while enrollment data is reloading", () => {
    expect(nextAvailableFingerprintSlot([enrollment(1), enrollment(3)], 2)).toBe(4);
  });

  it("falls back to the final sensor slot when every slot is occupied", () => {
    const fullSensor = Array.from({ length: 200 }, (_, index) => enrollment(index + 1));
    expect(nextAvailableFingerprintSlot(fullSensor)).toBe(200);
  });

  it("normalizes unexpected finger labels to the predefined default", () => {
    expect(normalizeFingerLabel("left-index")).toBe("left-index");
    expect(normalizeFingerLabel("free text")).toBe("right-index");
    expect(normalizeFingerLabel()).toBe("right-index");
  });

  it("shows roster names when local mappings can be joined to members", () => {
    expect(fingerprintEnrollmentName({ ...enrollment(7, "100007"), firstName: "Bench", lastName: "Member" })).toBe("100007 - Bench Member");
    expect(fingerprintEnrollmentName(enrollment(8, "100008"))).toBe("100008");
  });
});
