import { describe, expect, it } from "vitest";

import type { CardGenerationContext } from "../storage/card-generation-context-repository";
import type { MochiCard } from "../services/mochi-client";
import { analyzeBulkCards, checkBulkRegenerationAvailability } from "./bulk-card-regeneration";
import type { CardTemplate, MochiFieldBinding } from "./template";

describe("checkBulkRegenerationAvailability", () => {
  it("rejects unsupported and incomplete outputs", () => {
    expect(
      checkBulkRegenerationAvailability(template({ output: { kind: "card-body", templateMode: "none" } }), [])
    ).toEqual({ kind: "unavailable", reason: "unsupported-output" });
    const incomplete = template({
      output: { kind: "mochi-template", target: { status: "needs-configuration", templateId: "mochi-1" } },
    });
    expect(checkBulkRegenerationAvailability(incomplete, [incomplete])).toEqual({
      kind: "unavailable",
      reason: "needs-configuration",
    });
  });

  it("allows one configured template and rejects configured or incomplete conflicts in the same deck", () => {
    const selected = template();
    expect(checkBulkRegenerationAvailability(selected, [selected])).toEqual({
      kind: "available",
      mochiTemplateId: "mochi-1",
    });
    expect(checkBulkRegenerationAvailability(selected, [selected, template({ id: "second" })])).toEqual({
      kind: "unavailable",
      reason: "ambiguous-template",
    });
    expect(
      checkBulkRegenerationAvailability(selected, [
        selected,
        template({
          id: "incomplete",
          output: { kind: "mochi-template", target: { status: "needs-configuration", templateId: "mochi-1" } },
        }),
      ])
    ).toEqual({ kind: "unavailable", reason: "ambiguous-template" });
  });

  it("ignores an identical Mochi template in another deck", () => {
    const selected = template();
    expect(
      checkBulkRegenerationAvailability(selected, [selected, template({ id: "other", deckId: "deck-2" })])
    ).toEqual({
      kind: "available",
      mochiTemplateId: "mochi-1",
    });
  });
});

describe("analyzeBulkCards", () => {
  it("keeps matching context linked across revisions and supplements missing values from mappings", () => {
    const generationTemplate = template({
      fields: [
        { id: "word", name: "Word", type: "text", required: false, multiline: false },
        { id: "meaning", name: "Meaning", type: "text", required: false, multiline: false },
      ],
      output: {
        kind: "mochi-template",
        target: {
          status: "configured",
          template: snapshot(),
          bindings: [
            { kind: "input", targetFieldId: "front", sourceFieldId: "word" },
            { kind: "input", targetFieldId: "back", sourceFieldId: "meaning" },
          ],
        },
      },
    });
    const candidate = card({
      fields: [
        { id: "front", value: "from card" },
        { id: "back", value: "definition" },
      ],
    });
    const saved = context({
      generationTemplateUpdatedAt: "2025-01-01T00:00:00.000Z",
      inputValues: { word: "from context" },
    });

    expect(analyzeBulkCards(generationTemplate, [candidate], { "card-1": saved })).toEqual([
      {
        kind: "ready",
        source: "linked",
        card: candidate,
        values: { word: "from context", meaning: "definition" },
        context: saved,
      },
    ]);
  });

  it("infers complete mappings, rejects non-empty unlinked content, and supports templates without inputs", () => {
    const inferred = card();
    const nonEmpty = card({ id: "content", content: "manual" });
    expect(analyzeBulkCards(template(), [inferred, nonEmpty], {})).toMatchObject([
      { kind: "ready", source: "inferred", values: { word: "λόγος" } },
      { kind: "skipped", reason: "non-empty-unlinked-content" },
    ]);
    expect(
      analyzeBulkCards(template({ fields: [], output: configuredOutput([]) }), [card({ fields: [] })], {})
    ).toMatchObject([{ kind: "ready", source: "inferred", values: {} }]);
  });

  it("rejects foreign context and missing or conflicting inputs", () => {
    const foreign = context({ generationTemplateId: "other" });
    const missing = card({ id: "missing", fields: [] });
    const conflictingTemplate = template({
      output: configuredOutput([
        { kind: "input", targetFieldId: "front", sourceFieldId: "word" },
        { kind: "input", targetFieldId: "back", sourceFieldId: "word" },
      ]),
    });
    const conflicting = card({
      id: "conflicting",
      fields: [
        { id: "front", value: "one" },
        { id: "back", value: "two" },
      ],
    });

    expect(analyzeBulkCards(template(), [card()], { "card-1": foreign })).toMatchObject([
      { kind: "skipped", reason: "bound-to-different-template" },
    ]);
    expect(analyzeBulkCards(template(), [missing], {})).toMatchObject([
      { kind: "skipped", reason: "inputs-unavailable" },
    ]);
    expect(analyzeBulkCards(conflictingTemplate, [conflicting], {})).toMatchObject([
      { kind: "skipped", reason: "inputs-unavailable" },
    ]);
  });

  it("does not include cards from another deck or Mochi template", () => {
    expect(
      analyzeBulkCards(template(), [card({ deckId: "deck-2" }), card({ id: "other", templateId: "mochi-2" })], {})
    ).toEqual([]);
  });
});

function snapshot() {
  return {
    id: "mochi-1",
    name: "Mochi",
    fields: [
      { id: "front", name: "Front", type: "text", multiline: false },
      { id: "back", name: "Back", type: "text", multiline: false },
    ],
  } as const;
}

function configuredOutput(bindings: readonly MochiFieldBinding[]) {
  return { kind: "mochi-template", target: { status: "configured", template: snapshot(), bindings } } as const;
}

function template(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return {
    id: "generation-1",
    name: "Generation",
    fields: [{ id: "word", name: "Word", type: "text", required: false, multiline: false }],
    cardBody: "",
    output: configuredOutput([{ kind: "input", targetFieldId: "front", sourceFieldId: "word" }]),
    deckId: "deck-1",
    deckName: "Deck",
    tags: [],
    reviewReverse: false,
    archived: false,
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

function card(overrides: Partial<MochiCard> = {}): MochiCard {
  return {
    id: "card-1",
    deckId: "deck-1",
    content: "",
    name: "Card",
    tags: [],
    fields: [{ id: "front", value: "λόγος" }],
    reviews: [],
    aiCacheEntries: [],
    templateId: "mochi-1",
    ...overrides,
  };
}

function context(overrides: Partial<CardGenerationContext> = {}): CardGenerationContext {
  return {
    cardId: "card-1",
    generationTemplateId: "generation-1",
    generationTemplateUpdatedAt: "2026-07-28T00:00:00.000Z",
    mochiTemplateId: "mochi-1",
    inputValues: { word: "λόγος" },
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}
