import type { CardGenerationContext } from "../storage/card-generation-context-repository";
import type { MochiCard } from "../services/mochi-client";
import { recoverInputValues } from "./edit-card";
import type { CardTemplate, FieldValues } from "./template";

export type BulkRegenerationAvailability =
  | { readonly kind: "available"; readonly mochiTemplateId: string }
  | {
      readonly kind: "unavailable";
      readonly reason: "unsupported-output" | "needs-configuration" | "ambiguous-template";
    };

export type BulkCardAnalysis =
  | {
      readonly kind: "ready";
      readonly source: "linked" | "inferred";
      readonly card: MochiCard;
      readonly values: FieldValues;
      readonly context?: CardGenerationContext;
    }
  | {
      readonly kind: "skipped";
      readonly card: MochiCard;
      readonly reason: "bound-to-different-template" | "non-empty-unlinked-content" | "inputs-unavailable";
      readonly message: string;
    };

export function checkBulkRegenerationAvailability(
  selected: CardTemplate,
  templates: readonly CardTemplate[]
): BulkRegenerationAvailability {
  if (selected.output.kind !== "mochi-template") {
    return { kind: "unavailable", reason: "unsupported-output" };
  }
  if (selected.output.target.status !== "configured") {
    return { kind: "unavailable", reason: "needs-configuration" };
  }
  const mochiTemplateId = selected.output.target.template.id;
  const matching = templates.filter(
    (template) =>
      template.deckId === selected.deckId &&
      template.output.kind === "mochi-template" &&
      (template.output.target.status === "configured"
        ? template.output.target.template.id === mochiTemplateId
        : template.output.target.templateId === mochiTemplateId)
  );
  return matching.length === 1
    ? { kind: "available", mochiTemplateId }
    : { kind: "unavailable", reason: "ambiguous-template" };
}

export function analyzeBulkCards(
  template: CardTemplate,
  cards: readonly MochiCard[],
  contexts: Readonly<Record<string, CardGenerationContext>>
): readonly BulkCardAnalysis[] {
  if (template.output.kind !== "mochi-template" || template.output.target.status !== "configured") {
    return [];
  }
  const mochiTemplateId = template.output.target.template.id;
  return cards
    .filter((card) => card.deckId === template.deckId && card.templateId === mochiTemplateId)
    .map((card) => analyzeCandidate(template, card, contexts[card.id]));
}

function analyzeCandidate(
  template: CardTemplate,
  card: MochiCard,
  context: CardGenerationContext | undefined
): BulkCardAnalysis {
  const mochiTemplateId =
    template.output.kind === "mochi-template" && template.output.target.status === "configured"
      ? template.output.target.template.id
      : undefined;
  const linked = context?.generationTemplateId === template.id && context.mochiTemplateId === mochiTemplateId;
  if (context && !linked) {
    return {
      kind: "skipped",
      card,
      reason: "bound-to-different-template",
      message: "Saved context belongs to a different Generation Template or Mochi template.",
    };
  }
  if (!context && card.content.trim().length > 0) {
    return {
      kind: "skipped",
      card,
      reason: "non-empty-unlinked-content",
      message: "Unlinked content is not empty and may have been created with another output mode.",
    };
  }
  const recovery = recoverInputValues(template, card, linked ? context : undefined);
  if (recovery.issues.length > 0) {
    const fields = recovery.issues.map((issue) => `"${issue.fieldName}" (${issue.reason})`).join(", ");
    return {
      kind: "skipped",
      card,
      reason: "inputs-unavailable",
      message: `Inputs could not be recovered: ${fields}.`,
    };
  }
  return {
    kind: "ready",
    source: linked ? "linked" : "inferred",
    card,
    values: recovery.values,
    ...(linked && context ? { context } : {}),
  };
}
