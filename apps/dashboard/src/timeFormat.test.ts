import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime, localTimeInputValue } from "./timeFormat";

describe("dashboard time formatting", () => {
  it("formats legacy time-only meeting values without throwing", () => {
    expect(formatTime("15:00")).toMatch(/\d/);
    expect(localTimeInputValue("15:00")).toBe("15:00");
  });

  it("formats legacy date-plus-time values without throwing", () => {
    expect(formatTime("2026-08-26+15:00:00")).toMatch(/\d/);
    expect(localTimeInputValue("2026-08-26+15:00:00")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("leaves unknown date values visible instead of crashing the route", () => {
    expect(formatTime("not-a-date")).toBe("not-a-date");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
    expect(localTimeInputValue("not-a-date")).toBe("");
  });
});
