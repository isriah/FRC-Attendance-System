import { describe, expect, it } from "vitest";
import { defaultPublicDocsUrl, publicDocsUrl } from "./publicDocs";

describe("publicDocsUrl", () => {
  it("uses the canonical GitHub Pages project URL by default", () => {
    expect(publicDocsUrl()).toBe(defaultPublicDocsUrl);
  });

  it("accepts an explicitly configured public documentation URL", () => {
    expect(publicDocsUrl(" https://example.org/guide/ ")).toBe("https://example.org/guide/");
  });
});
