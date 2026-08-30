import { characterForKey, keyboardRows } from "../src/ui/touchKeyboard";
import { describe, expect, it } from "vitest";

describe("touch password keyboard", () => {
  it("shows a numeric row above familiar QWERTY rows and keeps destructive actions at row ends", () => {
    const letterRows = keyboardRows("letters");
    expect(letterRows.slice(0, 3).map((row) => row.map((key) => key.value).join(""))).toEqual(["1234567890", "qwertyuiop", "asdfghjkl"]);
    expect(letterRows[3]![0]).toMatchObject({ action: "shift" });
    expect(letterRows[3]!.at(-1)).toMatchObject({ action: "backspace" });
    expect(letterRows[4]).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "layout", label: "123" }),
      expect.objectContaining({ action: "space" })
    ]));
  });

  it("keeps numbers in the alternate symbol layout alongside space and backspace", () => {
    const symbolKeys = keyboardRows("symbols").flat();
    expect(symbolKeys.map((key) => key.value).join("")).toContain("1234567890");
    expect(symbolKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "layout", label: "ABC" }),
      expect.objectContaining({ action: "space" }),
      expect.objectContaining({ action: "backspace" })
    ]));
  });

  it("applies shift only to letter keys", () => {
    expect(characterForKey({ value: "q" }, true)).toBe("Q");
    expect(characterForKey({ value: "7" }, true)).toBe("7");
  });
});
