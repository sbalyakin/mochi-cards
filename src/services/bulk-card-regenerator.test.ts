import { describe, expect, it } from "vitest";

import type { BulkCardAnalysis } from "../domain/bulk-card-regeneration";
import type { CardTemplate, MochiTemplateSnapshot } from "../domain/template";
import type { CardGenerationContext } from "../storage/card-generation-context-repository";
import {
  regenerateBulkCard,
  runBulkCardBatch,
  type BulkCardRegeneratorDependencies,
  type BulkCardResult,
} from "./bulk-card-regenerator";
import type { MochiCard, UpdateMochiCardRequest } from "./mochi-client";

describe("regenerateBulkCard", () => {
  it("generates, replaces tags, preserves live unmapped fields, removes stale fields, and saves context", async () => {
    const fixture = dependencies();

    const result = await regenerateBulkCard(analysis(), template(), liveSnapshot(), fixture.dependencies);

    expect(result).toMatchObject({ kind: "updated" });
    expect(fixture.updates).toEqual([
      {
        templateId: "mochi-1",
        tags: ["generated"],
        fields: { front: "word", back: "generated meaning", extra: "keep" },
      },
    ]);
    expect(fixture.savedContexts).toEqual([
      expect.objectContaining({
        cardId: "card-1",
        generationTemplateId: "generation-1",
        generationTemplateUpdatedAt: "2026-07-28T00:00:00.000Z",
        mochiTemplateId: "mochi-1",
        inputValues: { word: "word" },
      }),
    ]);
    expect(fixture.cachedCards).toHaveLength(1);
  });

  it("does not update when AI generation fails", async () => {
    const fixture = dependencies({ aiError: new Error("model unavailable") });

    await expect(regenerateBulkCard(analysis(), template(), liveSnapshot(), fixture.dependencies)).resolves.toEqual({
      kind: "failed",
      message: "model unavailable",
    });
    expect(fixture.updates).toEqual([]);
  });

  it("regenerates a template without AI when no AI client is configured", async () => {
    const fixture = dependencies({ withoutAiClient: true });
    const withoutAi = template();
    if (withoutAi.output.kind !== "mochi-template" || withoutAi.output.target.status !== "configured") {
      throw new Error("Expected a configured Mochi template");
    }
    const staticTemplate: CardTemplate = {
      ...withoutAi,
      output: {
        ...withoutAi.output,
        target: {
          ...withoutAi.output.target,
          bindings: [
            { kind: "input", targetFieldId: "front", sourceFieldId: "word" },
            { kind: "custom", targetFieldId: "back", template: "static meaning" },
          ],
        },
      },
    };

    await expect(
      regenerateBulkCard(analysis(), staticTemplate, liveSnapshot(), fixture.dependencies)
    ).resolves.toMatchObject({ kind: "updated" });
    expect(fixture.updates[0]?.fields.back).toBe("static meaning");
  });

  it.each([
    ["deck", { deckId: "deck-2" }, "Card moved to another deck."],
    ["template", { templateId: "mochi-2" }, "Card now uses a different Mochi template."],
  ])("skips when the card changes %s", async (_label, cardOverrides, reason) => {
    const fixture = dependencies({ card: card(cardOverrides) });

    await expect(regenerateBulkCard(analysis(), template(), liveSnapshot(), fixture.dependencies)).resolves.toEqual({
      kind: "skipped",
      reason,
    });
    expect(fixture.updates).toEqual([]);
  });

  it("skips when the card changes during AI generation", async () => {
    const fixture = dependencies({
      onAsk: () => {
        fixture.setCard(card({ tags: ["changed"] }));
      },
    });

    await expect(regenerateBulkCard(analysis(), template(), liveSnapshot(), fixture.dependencies)).resolves.toEqual({
      kind: "skipped",
      reason: "Card changed in Mochi during generation.",
    });
    expect(fixture.updates).toEqual([]);
  });

  it("skips when the card changed after analysis before recovering saved inputs", async () => {
    const fixture = dependencies({ card: card({ fields: [{ id: "front", value: "new word" }] }) });

    await expect(regenerateBulkCard(analysis(), template(), liveSnapshot(), fixture.dependencies)).resolves.toEqual({
      kind: "skipped",
      reason: "Card changed in Mochi since the bulk analysis.",
    });
    expect(fixture.updates).toEqual([]);
  });

  it("returns updated with a warning when context persistence fails", async () => {
    const fixture = dependencies({ contextError: new Error("storage unavailable") });

    const result = await regenerateBulkCard(analysis(), template(), liveSnapshot(), fixture.dependencies);

    expect(result).toMatchObject({ kind: "updated" });
    expect(result.kind === "updated" ? result.warning : undefined).toContain(
      "inputs were not saved: storage unavailable"
    );
  });
});

describe("runBulkCardBatch", () => {
  it("runs sequentially and continues after one failed result", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const result = await runBulkCardBatch(
      ["one", "two", "three"],
      async (cardId) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(cardId);
        await Promise.resolve();
        active -= 1;
        return cardId === "two"
          ? { kind: "failed", message: "failed" }
          : { kind: "updated", card: card({ id: cardId }) };
      },
      new AbortController().signal
    );

    expect(order).toEqual(["one", "two", "three"]);
    expect(maxActive).toBe(1);
    expect(result).toMatchObject({
      one: { status: "updated" },
      two: { status: "failed" },
      three: { status: "updated" },
    });
  });

  it("cancels the active operation and does not start remaining cards", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const result = await runBulkCardBatch(
      ["one", "two"],
      async (cardId) => {
        started.push(cardId);
        controller.abort(new Error("cancel"));
        throw new Error("cancel");
      },
      controller.signal
    );

    expect(started).toEqual(["one"]);
    expect(result).toMatchObject({ one: { status: "cancelled" }, two: { status: "cancelled" } });
  });

  it("allows retrying only unfinished IDs with fresh processing", async () => {
    const attempts = new Map<string, number>();
    const process = async (cardId: string): Promise<BulkCardResult> => {
      const attempt = (attempts.get(cardId) ?? 0) + 1;
      attempts.set(cardId, attempt);
      return cardId === "retry" && attempt === 1
        ? { kind: "failed", message: "temporary" }
        : { kind: "updated", card: card({ id: cardId, name: `attempt-${attempt}` }) };
    };
    const first = await runBulkCardBatch(["done", "retry"], process, new AbortController().signal);
    const unfinished = Object.values(first)
      .filter((update) => update.status === "failed" || update.status === "cancelled")
      .map((update) => update.cardId);

    const retried = await runBulkCardBatch(unfinished, process, new AbortController().signal);

    expect(attempts).toEqual(
      new Map([
        ["done", 1],
        ["retry", 2],
      ])
    );
    expect(retried.retry).toMatchObject({ status: "updated", result: { card: { name: "attempt-2" } } });
  });
});

function dependencies(
  options: {
    readonly card?: MochiCard;
    readonly aiError?: Error;
    readonly contextError?: Error;
    readonly onAsk?: () => void;
    readonly withoutAiClient?: boolean;
  } = {}
) {
  let current = options.card ?? card();
  const updates: UpdateMochiCardRequest[] = [];
  const savedContexts: Omit<CardGenerationContext, "updatedAt">[] = [];
  const cachedCards: MochiCard[] = [];
  const dependencies: BulkCardRegeneratorDependencies = {
    async getCard(): Promise<MochiCard> {
      return current;
    },
    async updateCard(_cardId, request): Promise<void> {
      updates.push(request);
      current = {
        ...current,
        content: "",
        templateId: request.templateId,
        tags: request.tags,
        fields: Object.entries(request.fields).map(([id, value]) => ({ id, value })),
      };
    },
    ...(options.withoutAiClient
      ? {}
      : {
          aiClient: {
            async ask(): Promise<string> {
              options.onAsk?.();
              if (options.aiError) {
                throw options.aiError;
              }
              return "generated meaning";
            },
          },
        }),
    async saveContext(context): Promise<void> {
      if (options.contextError) {
        throw options.contextError;
      }
      savedContexts.push(context);
    },
    cacheCard(cached): void {
      cachedCards.push(cached);
    },
  };
  return {
    dependencies,
    updates,
    savedContexts,
    cachedCards,
    setCard(next: MochiCard): void {
      current = next;
    },
  };
}

function analysis(): Extract<BulkCardAnalysis, { readonly kind: "ready" }> {
  return { kind: "ready", source: "inferred", card: card(), values: { word: "word" } };
}

function template(): CardTemplate {
  return {
    id: "generation-1",
    name: "Generation",
    fields: [{ id: "word", name: "Word", type: "text", required: false, multiline: false }],
    cardBody: "",
    output: {
      kind: "mochi-template",
      target: {
        status: "configured",
        template: liveSnapshot(),
        bindings: [
          { kind: "input", targetFieldId: "front", sourceFieldId: "word" },
          { kind: "custom", targetFieldId: "back", template: "<ai>meaning</ai>" },
        ],
      },
    },
    deckId: "deck-1",
    deckName: "Deck",
    tags: ["generated"],
    reviewReverse: false,
    archived: false,
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
}

function liveSnapshot(): MochiTemplateSnapshot {
  return {
    id: "mochi-1",
    name: "Mochi",
    fields: [
      { id: "front", name: "Front", type: "text", multiline: false },
      { id: "back", name: "Back", type: "text", multiline: false },
      { id: "extra", name: "Extra", type: "text", multiline: false },
    ],
  };
}

function card(overrides: Partial<MochiCard> = {}): MochiCard {
  return {
    id: "card-1",
    deckId: "deck-1",
    content: "",
    name: "Card",
    tags: ["old"],
    fields: [
      { id: "front", value: "word" },
      { id: "extra", value: "keep" },
      { id: "removed", value: "drop" },
    ],
    reviews: [],
    aiCacheEntries: [],
    templateId: "mochi-1",
    ...overrides,
  };
}
