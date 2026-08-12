import { describe, expect, it } from "vitest";

import { foldSearchText, matchesSearchText } from "./text-search";

describe("search text folding", () => {
  it("strips Greek tonos and diaeresis", () => {
    expect(foldSearchText("λόγος")).toBe("λογος");
    expect(foldSearchText("Ἀθήνα")).toBe("αθηνα");
    expect(foldSearchText("ταΐζω")).toBe("ταιζω");
  });

  it("strips Latin and Cyrillic accents", () => {
    expect(foldSearchText("Café")).toBe("cafe");
    expect(foldSearchText("сло́во")).toBe("слово");
  });
});

describe("accent-insensitive matching", () => {
  it("matches an unaccented query against accented text", () => {
    expect(matchesSearchText("λόγος", "λογος")).toBe(true);
    expect(matchesSearchText("λόγος", "λογ")).toBe(true);
  });

  it("matches an accented query against unaccented text", () => {
    expect(matchesSearchText("λογος", "λόγος")).toBe(true);
  });

  it("keeps matching case-insensitively and on substrings", () => {
    expect(matchesSearchText("Ο Λόγος", "λογ")).toBe(true);
    expect(matchesSearchText("λόγος", "νερό")).toBe(false);
  });

  it("treats a blank query as a match", () => {
    expect(matchesSearchText("λόγος", "   ")).toBe(true);
  });
});
