import { describe, expect, it } from "vitest";

import { findDuplicateCardByName, normalizeCardName } from "./card-duplicates";

describe("card duplicate detection", () => {
  it("normalizes case, surrounding whitespace, and repeated spaces", () => {
    expect(normalizeCardName("  Hello   WORLD ")).toBe("hello world");
  });

  it("normalizes case independently from the system locale", () => {
    expect(normalizeCardName("I")).toBe("i");
  });

  it("finds a duplicate by Mochi card name", () => {
    const cards = [
      { id: "one", name: null },
      { id: "two", name: "Λόγος" },
    ];

    expect(findDuplicateCardByName(cards, "  λόγος ")).toEqual(cards[1]);
  });

  it("does not match an empty candidate", () => {
    expect(findDuplicateCardByName([{ id: "one", name: "" }], "  ")).toBeUndefined();
  });
});
