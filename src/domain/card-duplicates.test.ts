import { describe, expect, it } from "vitest";

import {
  deriveMochiCardName,
  findDuplicateCardByName,
  normalizeCardName,
  selectDuplicateCandidate,
} from "./card-duplicates";
import type { CardTemplate } from "./template";

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

  it.each([
    ["empty content", "", "Untitled card"],
    ["leading blank lines", "\r\n   \r\n# Heading", "Heading"],
    ["headings", "### Heading", "Heading"],
    ["horizontal and setext rules", "---\n===\nTitle", "Title"],
    ["quotes", "> Quoted text", "Quoted text"],
    ["lists", "- List item", "List item"],
    ["task lists", "- [x] Finished", "Finished"],
    ["fenced code", "```ts\nconst value = 1;\n```", "const value = 1;"],
    ["indented code", "    const value = 1;", "const value = 1;"],
    ["emphasis", "**bold** *emphasis* __strong__ ~~deleted~~ `code`", "bold emphasis strong deleted code"],
    ["links", "[Link label](https://example.com)", "Link label"],
    ["images", "![Image label](https://example.com/image.png)\nText", "Text"],
    ["autolinks", "<https://example.com>\nText", "Text"],
    ["HTML tags and comments", "<!-- ignore -->\n<div>Text</div>", "Text"],
    ["malformed angles", "<not closed", "<not closed"],
    ["entities and whitespace", "  &amp;  ", "&amp;  "],
    ["long line", "x".repeat(10_000), "x".repeat(10_000)],
  ])("derives Mochi names from %s", (_description, content, expected) => {
    expect(deriveMochiCardName(content)).toBe(expected);
  });

  it.each([
    ["four backticks closed by three", "````\ninside-four\n```\nafter-four", "inside-four"],
    ["backticks closed by tildes", "```\ninside-mixed\n~~~\nafter-mixed", "`"],
    ["four matching backticks", "````\ninside-matched\n````\nafter-matched", "inside-matched`"],
    ["four backticks closed by three before a heading", "````\n```\n# after-four-three", "after-four-three"],
    ["four matching backticks before a heading", "````\n````\n# after-four-four", "`"],
    ["backticks closed by tildes before a heading", "```\n~~~\n# after-mixed", "`"],
    ["matching tildes before a heading", "~~~\n~~~\n# after-tilde", "after-tilde"],
  ])("matches Mochi's observed fence name for %s", (_description, content, expected) => {
    expect(deriveMochiCardName(content)).toBe(expected);
  });

  it("selects the primary field for a specific Mochi template", () => {
    expect(
      selectDuplicateCandidate(createTemplate("mochi-template"), { word: "Primary", other: "Rendered" }, "create")
    ).toBe("Primary");
  });

  it.each(["none", "deck-default"] as const)("derives rendered Card Body names for %s", (templateMode) => {
    expect(
      selectDuplicateCandidate(createTemplate("card-body", templateMode), { word: "Primary" }, "create", "# Rendered")
    ).toBe("Rendered");
  });

  it("does not select a duplicate candidate when updating", () => {
    expect(
      selectDuplicateCandidate(createTemplate("mochi-template"), { word: "Primary" }, "update", "# Rendered")
    ).toBeUndefined();
  });
});

function createTemplate(
  kind: "mochi-template" | "card-body",
  templateMode: "none" | "deck-default" = "none"
): CardTemplate {
  return {
    id: "template-1",
    name: "Template",
    fields: [{ id: "word", name: "word", type: "text", required: true, multiline: false }],
    cardBody: "# <<word>>",
    output:
      kind === "card-body"
        ? { kind, templateMode }
        : {
            kind,
            target: {
              status: "configured",
              template: { id: "mochi-template-1", name: "Mochi template", fields: [] },
              bindings: [],
            },
          },
    deckId: "deck-1",
    deckName: "Deck",
    tags: [],
    reviewReverse: false,
    archived: false,
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
}
