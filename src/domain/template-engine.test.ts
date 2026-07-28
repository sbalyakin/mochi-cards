import { describe, expect, it } from "vitest";

import type { CardTemplate } from "./template";
import { templateUsesAi } from "./template-engine";

describe("templateUsesAi", () => {
  it("detects AI fields in the card body", () => {
    expect(templateUsesAi(template({ cardBody: "Before <ai>prompt</ai> after" }))).toBe(true);
  });

  it("detects AI fields in custom Mochi bindings", () => {
    expect(
      templateUsesAi(
        template({
          output: {
            kind: "mochi-template",
            target: {
              status: "configured",
              template: {
                id: "mochi-template",
                name: "Words",
                fields: [{ id: "back", name: "Back", type: "text", multiline: true }],
              },
              bindings: [{ kind: "custom", targetFieldId: "back", template: "<ai>Explain the word</ai>" }],
            },
          },
        })
      )
    ).toBe(true);
  });

  it("does not require AI for templates without AI fields", () => {
    expect(templateUsesAi(template({ cardBody: "Plain <<word>>" }))).toBe(false);
  });
});

function template(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return {
    id: "template",
    name: "Template",
    fields: [{ id: "word", name: "word", type: "text", required: true, multiline: false }],
    cardBody: "Plain text",
    output: { kind: "card-body", templateMode: "none" },
    deckId: "deck",
    deckName: "Deck",
    tags: [],
    reviewReverse: false,
    archived: false,
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}
