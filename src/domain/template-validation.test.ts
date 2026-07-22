import { describe, expect, it } from "vitest";

import type { CardTemplateDraft } from "./template";
import { validateTemplate } from "./template-validation";

describe("validateTemplate", () => {
  it("accepts repeated uses of declared fields", () => {
    const draft = createDraft({ content: "# <<word>>\n\nAgain: <<word>>" });
    expect(validateTemplate(draft)).toEqual([]);
  });

  it("accepts placeholders with surrounding whitespace", () => {
    const draft = createDraft({ content: "# <<   word       >>" });
    expect(validateTemplate(draft)).toEqual([]);
  });

  it("reports duplicate and malformed field names", () => {
    const draft = createDraft({
      fields: [
        { name: "word", required: true },
        { name: "word", required: false },
        { name: "1bad", required: false },
      ],
    });
    expect(validateTemplate(draft).map((error) => error.code)).toEqual(
      expect.arrayContaining(["field-name-duplicate", "field-name-invalid"])
    );
  });

  it("blocks unknown placeholders and malformed AI fields", () => {
    const draft = createDraft({ content: "<<missing>>\n<ai>" });
    expect(validateTemplate(draft).map((error) => error.code)).toEqual(
      expect.arrayContaining(["unknown-placeholder", "unclosed-ai"])
    );
  });

  it("requires a selected Mochi deck", () => {
    expect(validateTemplate(createDraft({ deckName: "" }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "deck-name-required", path: "deckId" })])
    );
  });
});

function createDraft(overrides: Partial<CardTemplateDraft> = {}): CardTemplateDraft {
  return {
    name: "Words",
    fields: [{ name: "word", required: true }],
    content: "# <<word>>",
    deckId: "deck-1",
    deckName: "Vocabulary",
    mochiTemplateId: null,
    tags: [],
    reviewReverse: false,
    archived: false,
    ...overrides,
  };
}
