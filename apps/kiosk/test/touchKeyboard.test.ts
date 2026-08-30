import { characterForKey, keyboardRows } from "../src/ui/touchKeyboard";
import { describe, expect, it } from "vitest";

describe("touch password keyboard", () => {
  it("uses familiar QWERTY rows and puts destructive actions at row ends", () => {
    expect(keyboardRows("letters").slice(0, 2).map((row) => row.map((key) => key.value).join(""))).toEqual(["qwertyuiop", "asdfghjkl"]);
    expect(keyboardRows("letters")[2]![0]).toMatchObject({ action: "shift" });
    expect(keyboardRows("letters")[2]!.at(-1)).toMatchObject({ action: "backspace" });
  });

  it("offers a separate number and symbol layout plus space and backspace", () => {
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
