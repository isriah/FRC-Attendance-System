import { describe, expect, it } from "vitest";
import { buildLegacySheetExport } from "../src/export";
import type { Env } from "../src/env";

describe("legacy export", () => {
  it("formats login and logout ranges for Google Sheets", async () => {
    const env = {
      DB: {
        prepare: () => ({
          all: async () => ({
            results: [{
              student_id: "100001",
              meeting_date: "2026-01-02",
              check_in_at: "2026-01-02T20:00:00.000Z",
              check_out_at: "2026-01-02T22:00:00.000Z"
            }]
          })
        })
      }
    } as unknown as Env;

    const result = await buildLegacySheetExport(env);
    expect(result.ranges.AttendanceLogIn[0]?.[0]).toBe("100001");
    expect(result.ranges.AttendanceLogIn[0]?.[1]).toBe("1/2/2026");
    expect(result.ranges.AttendanceLogOut).toHaveLength(1);
  });
});
