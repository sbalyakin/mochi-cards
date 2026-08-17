import { describe, expect, it } from "vitest";

import { foldSearchText, matchesSearchText, startsWithSearchTextWord } from "./text-search";

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

describe("matchesSearchText", () => {
  it("keeps accents significant by default", () => {
    expect(matchesSearchText("λόγος", "λογος")).toBe(false);
    expect(matchesSearchText("λόγος", "λόγ")).toBe(true);
    expect(matchesSearchText("Ο Λόγος", "λόγ")).toBe(true);
  });

  it("ignores accents in both directions when asked", () => {
    expect(matchesSearchText("λόγος", "λογος", { ignoreAccents: true })).toBe(true);
    expect(matchesSearchText("λογος", "λόγος", { ignoreAccents: true })).toBe(true);
    expect(matchesSearchText("Ο Λόγος", "λογ", { ignoreAccents: true })).toBe(true);
    expect(matchesSearchText("λόγος", "νερό", { ignoreAccents: true })).toBe(false);
  });

  it("treats a blank query as a match", () => {
    expect(matchesSearchText("λόγος", "   ")).toBe(true);
    expect(matchesSearchText("λόγος", "   ", { ignoreAccents: true })).toBe(true);
  });
});

describe("startsWithSearchTextWord", () => {
  it("matches only word starts", () => {
    expect(startsWithSearchTextWord("Cardinal bird", "car")).toBe(true);
    expect(startsWithSearchTextWord("Blue cardinal", "car")).toBe(true);
    expect(startsWithSearchTextWord("Discarded note", "car")).toBe(false);
  });

  it("matches multi-word queries at word starts", () => {
    expect(startsWithSearchTextWord("Blue cardinal bird", "blue car")).toBe(true);
    expect(startsWithSearchTextWord("Pale blue cardinal bird", "blue car")).toBe(true);
    expect(startsWithSearchTextWord("Blue discarded cardinal", "blue car")).toBe(false);
  });

  it("uses accent-insensitive matching when asked", () => {
    expect(startsWithSearchTextWord("Ο Λόγος", "λογ", { ignoreAccents: true })).toBe(true);
    expect(startsWithSearchTextWord("Ο Λόγος", "λογ")).toBe(false);
  });
});
