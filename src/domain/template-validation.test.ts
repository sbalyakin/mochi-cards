import { describe, expect, it } from "vitest";

import type { CardTemplateDraft } from "./template";
import { validateTemplate } from "./template-validation";

describe("validateTemplate", () => {
  it("accepts repeated uses of declared variables", () => {
    const draft = createDraft({ content: "# <<word>>\n\nAgain: <<word>>" });
    expect(validateTemplate(draft)).toEqual([]);
  });

  it("reports duplicate, malformed, and empty variable metadata", () => {
    const draft = createDraft({
      variables: [
        { name: "word", label: "Word", required: true },
        { name: "word", label: "", required: false },
        { name: "1bad", label: "Bad", required: false },
      ],
    });
    expect(validateTemplate(draft).map((error) => error.code)).toEqual(
      expect.arrayContaining(["variable-name-duplicate", "variable-label-required", "variable-name-invalid"])
    );
  });

  it("blocks unknown placeholders and malformed AI fields", () => {
    const draft = createDraft({ content: "<<missing>>\n<ai>" });
    expect(validateTemplate(draft).map((error) => error.code)).toEqual(
      expect.arrayContaining(["unknown-placeholder", "unclosed-ai"])
    );
  });
});

function createDraft(overrides: Partial<CardTemplateDraft> = {}): CardTemplateDraft {
  return {
    name: "Words",
    variables: [{ name: "word", label: "Word", required: true }],
    content: "# <<word>>",
    deckId: "deck-1",
    tags: [],
    reviewReverse: false,
    archived: false,
    ...overrides,
  };
}
