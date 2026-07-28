import type { BulkCardAnalysis } from "../domain/bulk-card-regeneration";
import { cardChangedSinceOpen, mergeUpdateFields, recoverInputValues } from "../domain/edit-card";
import { generateSession, getAiFieldErrors, getMochiOutput, isSessionReady } from "../domain/generation-session";
import type { CardTemplate, MochiTemplateSnapshot } from "../domain/template";
import type { AiClient } from "../domain/template-engine";
import type { CardGenerationContext } from "../storage/card-generation-context-repository";
import type { MochiCard, UpdateMochiCardRequest } from "./mochi-client";

export type BulkCardResult =
  | { readonly kind: "updated"; readonly card: MochiCard; readonly warning?: string }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "failed"; readonly message: string };

export interface BulkCardRegeneratorDependencies {
  getCard(cardId: string, signal?: AbortSignal): Promise<MochiCard>;
  updateCard(cardId: string, request: UpdateMochiCardRequest, signal?: AbortSignal): Promise<void>;
  readonly aiClient: AiClient;
  saveContext(context: Omit<CardGenerationContext, "updatedAt">): Promise<unknown>;
  cacheCard?(card: MochiCard): Promise<void> | void;
}

export async function regenerateBulkCard(
  analysis: Extract<BulkCardAnalysis, { readonly kind: "ready" }>,
  template: CardTemplate,
  liveMochiTemplate: MochiTemplateSnapshot,
  dependencies: BulkCardRegeneratorDependencies,
  signal?: AbortSignal
): Promise<BulkCardResult> {
  if (
    template.output.kind !== "mochi-template" ||
    template.output.target.status !== "configured" ||
    template.output.target.template.id !== liveMochiTemplate.id
  ) {
    return { kind: "failed", message: "Generation Template is not configured for the live Mochi template." };
  }

  let current: MochiCard;
  try {
    throwIfAborted(signal);
    current = await dependencies.getCard(analysis.card.id, signal);
  } catch (error: unknown) {
    throwIfAborted(signal);
    return { kind: "failed", message: `Could not load the current card: ${errorMessage(error)}` };
  }
  if (current.deckId !== template.deckId) {
    return { kind: "skipped", reason: "Card moved to another deck." };
  }
  if (current.templateId !== liveMochiTemplate.id) {
    return { kind: "skipped", reason: "Card now uses a different Mochi template." };
  }
  if (cardChangedSinceOpen(analysis.card, current)) {
    return { kind: "skipped", reason: "Card changed in Mochi since the bulk analysis." };
  }

  const recovery = recoverInputValues(template, current, analysis.context);
  if (recovery.issues.length > 0) {
    return { kind: "skipped", reason: "Current inputs can no longer be recovered safely." };
  }

  let session;
  try {
    session = await generateSession(template, recovery.values, dependencies.aiClient, signal);
  } catch (error: unknown) {
    throwIfAborted(signal);
    return { kind: "failed", message: `Generation failed: ${errorMessage(error)}` };
  }
  const generationErrors = getAiFieldErrors(session);
  if (!isSessionReady(session) || generationErrors.length > 0) {
    return {
      kind: "failed",
      message: generationErrors.map((error) => error.message).join("; ") || "Generated session is not ready.",
    };
  }

  let latest: MochiCard;
  try {
    latest = await dependencies.getCard(current.id, signal);
  } catch (error: unknown) {
    throwIfAborted(signal);
    return { kind: "failed", message: `Could not verify the current card: ${errorMessage(error)}` };
  }
  if (cardChangedSinceOpen(current, latest)) {
    return { kind: "skipped", reason: "Card changed in Mochi during generation." };
  }

  const output = getMochiOutput(session);
  if (!output || output.templateId !== liveMochiTemplate.id) {
    return { kind: "failed", message: "Generation did not produce the expected Mochi template output." };
  }
  const liveFieldIds = new Set(liveMochiTemplate.fields.map((field) => field.id));
  const fields = Object.fromEntries(
    Object.entries(mergeUpdateFields(latest, liveMochiTemplate.id, output.fields)).filter(([fieldId]) =>
      liveFieldIds.has(fieldId)
    )
  );

  try {
    await dependencies.updateCard(latest.id, { templateId: liveMochiTemplate.id, fields, tags: template.tags }, signal);
  } catch (error: unknown) {
    throwIfAborted(signal);
    return { kind: "failed", message: `Could not update the card: ${errorMessage(error)}` };
  }

  let updatedCard: MochiCard = {
    ...latest,
    content: "",
    templateId: liveMochiTemplate.id,
    tags: template.tags,
    fields: Object.entries(fields).map(([id, value]) => ({ id, value })),
  };
  const warnings: string[] = [];
  try {
    await dependencies.saveContext({
      cardId: latest.id,
      generationTemplateId: template.id,
      generationTemplateUpdatedAt: template.updatedAt,
      mochiTemplateId: liveMochiTemplate.id,
      inputValues: recovery.values,
    });
  } catch (error: unknown) {
    warnings.push(`inputs were not saved: ${errorMessage(error)}`);
  }
  try {
    updatedCard = await dependencies.getCard(latest.id, signal);
    try {
      await dependencies.cacheCard?.(updatedCard);
    } catch (error: unknown) {
      warnings.push(`card-name cache was not refreshed: ${errorMessage(error)}`);
    }
  } catch (error: unknown) {
    warnings.push(`updated card could not be refreshed: ${errorMessage(error)}`);
  }

  return {
    kind: "updated",
    card: updatedCard,
    ...(warnings.length > 0 ? { warning: `Card was updated, but ${warnings.join("; ")}.` } : {}),
  };
}

export type BulkCardOperationStatus =
  "pending" | "running" | "updated" | "updated-with-warning" | "failed" | "skipped" | "cancelled";

export type BulkCardOperationUpdate = {
  readonly cardId: string;
  readonly status: BulkCardOperationStatus;
  readonly message?: string;
  readonly result?: BulkCardResult;
};

export async function runBulkCardBatch(
  cardIds: readonly string[],
  process: (cardId: string, signal: AbortSignal) => Promise<BulkCardResult>,
  signal: AbortSignal,
  onUpdate?: (update: BulkCardOperationUpdate) => void
): Promise<Readonly<Record<string, BulkCardOperationUpdate>>> {
  const updates: Record<string, BulkCardOperationUpdate> = {};
  const report = (update: BulkCardOperationUpdate): void => {
    updates[update.cardId] = update;
    onUpdate?.(update);
  };

  for (let index = 0; index < cardIds.length; index += 1) {
    if (signal.aborted) {
      for (const remainingId of cardIds.slice(index)) {
        report({ cardId: remainingId, status: "cancelled", message: "Operation cancelled." });
      }
      break;
    }
    const cardId = cardIds[index];
    report({ cardId, status: "running" });
    try {
      const result = await process(cardId, signal);
      if (result.kind === "updated") {
        report({
          cardId,
          status: result.warning ? "updated-with-warning" : "updated",
          ...(result.warning ? { message: result.warning } : {}),
          result,
        });
      } else if (result.kind === "skipped") {
        report({ cardId, status: "skipped", message: result.reason, result });
      } else {
        report({ cardId, status: "failed", message: result.message, result });
      }
    } catch (error: unknown) {
      report(
        signal.aborted
          ? { cardId, status: "cancelled", message: "Operation cancelled." }
          : { cardId, status: "failed", message: errorMessage(error) }
      );
    }
  }
  return updates;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Operation cancelled");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Unexpected error";
}
