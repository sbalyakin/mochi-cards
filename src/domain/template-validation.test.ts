import { describe, expect, it } from "vitest";

import type { CardTemplateDraft } from "./template";
import { validateTemplate } from "./template-validation";

describe("validateTemplate", () => {
  it("accepts repeated uses of declared fields", () => {
    const draft = createDraft({ cardBody: "# <<word>>\n\nAgain: <<word>>" });
    expect(validateTemplate(draft)).toEqual([]);
  });

  it("accepts placeholders with surrounding whitespace", () => {
    const draft = createDraft({ cardBody: "# <<   word       >>" });
    expect(validateTemplate(draft)).toEqual([]);
  });

  it("reports duplicate and malformed field names", () => {
    const draft = createDraft({
      fields: [
        { id: "one", name: "word", type: "text", required: true, multiline: false },
        { id: "two", name: "word", type: "text", required: false, multiline: false },
        { id: "three", name: "1bad", type: "text", required: false, multiline: false },
      ],
    });
    expect(validateTemplate(draft).map((error) => error.code)).toEqual(
      expect.arrayContaining(["field-name-duplicate", "field-name-invalid"])
    );
  });

  it("blocks unknown placeholders and malformed AI fields", () => {
    const draft = createDraft({ cardBody: "<<missing>>\n<ai>" });
    expect(validateTemplate(draft).map((error) => error.code)).toEqual(
      expect.arrayContaining(["unknown-placeholder", "unclosed-ai"])
    );
  });

  it("requires a selected Mochi deck", () => {
    expect(validateTemplate(createDraft({ deckName: "" }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "deck-name-required", path: "deckId" })])
    );
  });

  it("validates direct and custom Mochi mappings while allowing no mappings", () => {
    const base = createDraft({
      fields: [
        { id: "word", name: "word", type: "text", required: true, multiline: false },
        { id: "count", name: "count", type: "number", required: false },
      ],
      output: {
        kind: "mochi-template",
        target: {
          status: "configured",
          template: {
            id: "remote",
            name: "Remote",
            fields: [
              { id: "front", name: "Front", type: "text", multiline: false },
              { id: "amount", name: "Amount", type: "number", multiline: false },
            ],
          },
          bindings: [],
        },
      },
    });
    expect(validateTemplate(base)).toEqual([]);
    const invalid = {
      ...base,
      output: {
        kind: "mochi-template" as const,
        target: {
          status: "configured" as const,
          template: {
            id: "remote",
            name: "Remote",
            fields: [
              { id: "front", name: "Front", type: "text", multiline: false },
              { id: "amount", name: "Amount", type: "number", multiline: false },
            ],
          },
          bindings: [
            { kind: "input" as const, targetFieldId: "amount", sourceFieldId: "word" },
            { kind: "custom" as const, targetFieldId: "front", template: "<<missing>>" },
          ],
        },
      },
    };
    expect(validateTemplate(invalid).map((error) => error.code)).toEqual(
      expect.arrayContaining(["binding-type-incompatible", "unknown-placeholder"])
    );
  });

  it("blocks migrated Mochi targets until mappings are configured", () => {
    expect(
      validateTemplate({
        ...createDraft(),
        output: {
          kind: "mochi-template",
          target: { status: "needs-configuration", templateId: "remote" },
        },
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "target-needs-configuration" })]));
  });
});

function createDraft(overrides: Partial<CardTemplateDraft> = {}): CardTemplateDraft {
  return {
    name: "Words",
    fields: [{ id: "word", name: "word", type: "text", required: true, multiline: false }],
    cardBody: "# <<word>>",
    output: { kind: "card-body" },
    deckId: "deck-1",
    deckName: "Vocabulary",
    tags: [],
    reviewReverse: false,
    archived: false,
    ...overrides,
  };
}
