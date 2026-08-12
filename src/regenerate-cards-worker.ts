import { getPreferenceValues, LaunchProps, showToast, Toast } from "@raycast/api";

import { cardTitle } from "./card-sorting";
import { parseRegenerationJob, type RegenerationJob } from "./domain/bulk-card-regeneration";
import { templateUsesAi, type AiClient } from "./domain/template-engine";
import { createAiClient } from "./services/ai-client-factory";
import {
  loadLiveTemplate,
  operationSummary,
  reanalyzeAndRegenerate,
  runBulkCardBatch,
} from "./services/bulk-card-regenerator";
import { MochiClient } from "./services/mochi-client";
import { aiSettingsRepository } from "./services/raycast-ai-settings-repository";
import { CardCacheRepository, upsertCreatedCardBestEffort } from "./storage/card-cache-repository";
import { CardGenerationContextRepository } from "./storage/card-generation-context-repository";
import { RegenerationLockRepository } from "./storage/regeneration-lock-repository";
import { RegenerationReportRepository, type RegenerationCardOutcome } from "./storage/regeneration-report-repository";
import { TemplateRepository } from "./storage/template-repository";

type Preferences = { readonly mochiApiKey: string };

const templateRepository = new TemplateRepository();
const contextRepository = new CardGenerationContextRepository();
const cardCacheRepository = new CardCacheRepository();
const reportRepository = new RegenerationReportRepository();
const lockRepository = new RegenerationLockRepository();

export default async function Command(props: LaunchProps<{ launchContext?: Record<string, unknown> }>): Promise<void> {
  const job = parseRegenerationJob(props.launchContext);
  if (job && !(await ownsLease(job.lockToken))) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Regeneration Lease Lost",
      message: "Another regeneration owns the lease. No cards were changed.",
    });
    return;
  }

  const abortController = new AbortController();
  const heartbeat = job ? startLeaseHeartbeat(job.lockToken, () => abortController.abort()) : undefined;
  try {
    try {
      await run(job, abortController.signal);
    } finally {
      await heartbeat?.stop();
    }
  } finally {
    if (job) {
      try {
        await lockRepository.release(job.lockToken);
      } catch (error: unknown) {
        console.error("Could not release regeneration lease", error);
      }
    }
  }
}

/**
 * Confirms the lease is still ours before the first card is touched. The interval
 * heartbeat only fires minutes later, so without this check a worker whose lease
 * was already taken over would mutate cards alongside its successor.
 */
async function ownsLease(token: string): Promise<boolean> {
  try {
    return await lockRepository.heartbeat(token);
  } catch (error: unknown) {
    console.error("Could not verify regeneration lease", error);
    return false;
  }
}

/**
 * Refreshes the lease on an interval and aborts the batch if the lease is lost
 * or cannot be refreshed. `stop()` clears the timer and awaits the in-flight
 * heartbeat so no write can land after the caller proceeds to `release()`.
 */
function startLeaseHeartbeat(
  token: string,
  onLeaseLost: () => void,
  intervalMs = 2 * 60 * 1000
): { stop(): Promise<void> } {
  let pending: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    pending = lockRepository
      .heartbeat(token)
      .then((stillOwns) => {
        if (!stillOwns) {
          onLeaseLost();
        }
      })
      .catch((error: unknown) => {
        console.error("Could not refresh regeneration lease", error);
        onLeaseLost();
      });
  }, intervalMs);
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await pending;
    },
  };
}

async function run(job: RegenerationJob | undefined, signal: AbortSignal): Promise<void> {
  if (!job || job.cardIds.length === 0) {
    await showToast({
      style: Toast.Style.Failure,
      title: "No Regeneration Job",
      message: "Start this from Manage Templates → Regenerate Cards…",
    });
    return;
  }

  const template = await templateRepository.get(job.templateId);
  if (!template) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could Not Start Regeneration",
      message: "Generation Template was deleted.",
    });
    return;
  }

  let aiClient: AiClient | undefined;
  try {
    aiClient = templateUsesAi(template) ? createAiClient(await aiSettingsRepository.get()) : undefined;
  } catch (error: unknown) {
    await showToast({
      style: Toast.Style.Failure,
      title: "AI Provider Configuration Required",
      message: errorMessage(error),
    });
    return;
  }

  const client = new MochiClient(getPreferenceValues<Preferences>().mochiApiKey);
  const startedAt = new Date().toISOString();
  let mutationSnapshot;
  try {
    mutationSnapshot = await loadLiveTemplate(client, template);
  } catch (error: unknown) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could Not Start Regeneration",
      message: errorMessage(error),
    });
    return;
  }

  const total = job.cardIds.length;
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `Regenerating Mochi cards (1 of ${total})`,
  });

  let started = 0;
  const finalUpdates = await runBulkCardBatch(
    job.cardIds,
    (cardId, signal) =>
      reanalyzeAndRegenerate(
        cardId,
        mutationSnapshot,
        aiClient,
        {
          getCard: (id, operationSignal) => client.getCard(id, operationSignal),
          updateCard: (id, request, operationSignal) => client.updateCard(id, request, operationSignal),
          saveContext: (context) => contextRepository.save(context),
          cacheCard: (card) => upsertCreatedCardBestEffort(cardCacheRepository, card.deckId, card),
          getContexts: (cardIds) => contextRepository.getMany(cardIds),
        },
        signal
      ),
    signal,
    (update) => {
      if (update.status === "running") {
        started += 1;
      }
      // The card being worked on, so the count never reads as 0 of N.
      toast.title = `Regenerating Mochi cards (${Math.min(Math.max(started, 1), total)} of ${total})`;
    }
  );

  const updatesList = Object.values(finalUpdates);
  const outcomes: RegenerationCardOutcome[] = updatesList.map((update) => ({
    cardId: update.cardId,
    title: update.result?.kind === "updated" ? cardTitle(update.result.card) : update.cardId,
    status: update.status,
    ...(update.message ? { message: update.message } : {}),
  }));
  let reportSaveFailed = false;
  try {
    await reportRepository.save({
      templateId: template.id,
      templateName: template.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      updates: outcomes,
    });
  } catch (error: unknown) {
    reportSaveFailed = true;
    console.error("Could not save regeneration report", error);
  }

  const warningCount = updatesList.filter((update) => update.status === "updated-with-warning").length;
  const updatedCount = updatesList.filter(
    (update) => update.status === "updated" || update.status === "updated-with-warning"
  ).length;
  const hasIssues =
    reportSaveFailed ||
    warningCount > 0 ||
    updatesList.some(
      (update) => update.status === "failed" || update.status === "cancelled" || update.status === "skipped"
    );
  toast.style = hasIssues ? Toast.Style.Failure : Toast.Style.Success;
  toast.title = hasIssues
    ? `Regenerated ${updatedCount} of ${cardCount(total)} with issues${warningCount > 0 ? ` (${warningCount} warnings)` : ""}`
    : `Regenerated ${cardCount(updatedCount)}`;
  toast.message = [operationSummary([], finalUpdates), reportSaveFailed ? "Report could not be saved." : undefined]
    .filter(Boolean)
    .join(" ");
  if (!toast.message) {
    toast.message = "No cards processed.";
  }
}

function cardCount(count: number): string {
  return `${count} Mochi card${count === 1 ? "" : "s"}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Unexpected error";
}
