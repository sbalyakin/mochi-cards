import { Alert, closeMainWindow, confirmAlert, Icon, launchCommand, LaunchType, showToast, Toast } from "@raycast/api";

import {
  analyzeBulkCards,
  checkBulkRegenerationAvailability,
  type RegenerationJob,
} from "../domain/bulk-card-regeneration";
import type { CardTemplate } from "../domain/template";
import { templateUsesAi } from "../domain/template-engine";
import { CardGenerationContextRepository } from "../storage/card-generation-context-repository";
import { RegenerationLockRepository } from "../storage/regeneration-lock-repository";
import { createAiClient } from "./ai-client-factory";
import { AiProviderError } from "./ai-provider";
import { loadLiveTemplate } from "./bulk-card-regenerator";
import type { MochiClient } from "./mochi-client";
import { aiSettingsRepository } from "./raycast-ai-settings-repository";

const contextRepository = new CardGenerationContextRepository();
const lockRepository = new RegenerationLockRepository();

export async function startBulkRegeneration(
  client: MochiClient,
  template: CardTemplate,
  templates: readonly CardTemplate[]
): Promise<void> {
  if (checkBulkRegenerationAvailability(template, templates).kind !== "available") {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could Not Start Regeneration",
      message: "Bulk regeneration is no longer available for this Generation Template.",
    });
    return;
  }

  try {
    if (templateUsesAi(template)) {
      createAiClient(await aiSettingsRepository.get());
    }
  } catch (error: unknown) {
    await showToast({
      style: Toast.Style.Failure,
      title: "AI Provider Configuration Required",
      message: errorMessage(error),
      primaryAction:
        error instanceof AiProviderError && error.kind === "configuration"
          ? {
              title: "Configure AI Provider",
              onAction: () => launchCommand({ name: "configure-ai", type: LaunchType.UserInitiated }),
            }
          : undefined,
    });
    return;
  }

  const analyzingToast = await showToast({ style: Toast.Style.Animated, title: "Analyzing Cards…" });
  let readyIds: string[];
  let readyCount: number;
  let skippedCount: number;
  try {
    const snapshot = await loadLiveTemplate(client, template);
    const cards = await client.listCards(template.deckId);
    const candidateIds = cards
      .filter((card) => card.deckId === template.deckId && card.templateId === snapshot.liveMochiTemplate.id)
      .map((card) => card.id);
    const contexts = await contextRepository.getMany(candidateIds);
    const analysis = analyzeBulkCards(snapshot.generationTemplate, cards, contexts);
    readyIds = analysis.filter((item) => item.kind === "ready").map((item) => item.card.id);
    readyCount = readyIds.length;
    skippedCount = analysis.length - readyCount;
  } catch (error: unknown) {
    await analyzingToast.hide();
    await showToast({ style: Toast.Style.Failure, title: "Could Not Analyze Cards", message: errorMessage(error) });
    return;
  }
  await analyzingToast.hide();

  if (readyCount === 0) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Nothing to Regenerate",
      message: "No cards are currently eligible for regeneration.",
    });
    return;
  }

  const confirmed = await confirmAlert({
    icon: Icon.Warning,
    title: `Regenerate ${readyCount} Cards?`,
    message: [
      `${readyCount} cards will be regenerated in the background. This may take a while.`,
      "Generated fields, card content, and tags will be overwritten.",
      skippedCount > 0 ? `${skippedCount} cards will be skipped.` : undefined,
      "This cannot be undone.",
    ]
      .filter(Boolean)
      .join("\n"),
    primaryAction: { title: `Regenerate ${readyCount} Cards`, style: Alert.ActionStyle.Destructive },
  });
  if (!confirmed) {
    return;
  }

  let lockToken: string | undefined;
  try {
    lockToken = await lockRepository.acquire();
  } catch (lockError: unknown) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could Not Start Regeneration",
      message: errorMessage(lockError),
    });
    return;
  }
  if (!lockToken) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Regeneration Already Running",
      message: "Wait for the current background regeneration to finish before starting another.",
    });
    return;
  }

  try {
    await launchCommand({
      name: "regenerate-cards-worker",
      type: LaunchType.UserInitiated,
      context: { templateId: template.id, cardIds: readyIds, lockToken } satisfies RegenerationJob,
    });
  } catch (launchError: unknown) {
    await releaseQuietly(lockToken);
    await showToast({
      style: Toast.Style.Failure,
      title: "Could Not Start Regeneration",
      message: errorMessage(launchError),
    });
    return;
  }
  // The worker owns the progress toast from its first card on, and it only shows up
  // as a desktop toast once the Raycast window is gone.
  await closeMainWindow();
}

async function releaseQuietly(lockToken: string): Promise<void> {
  try {
    await lockRepository.release(lockToken);
  } catch (error: unknown) {
    console.error("Could not release regeneration lease", error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Unexpected error";
}
