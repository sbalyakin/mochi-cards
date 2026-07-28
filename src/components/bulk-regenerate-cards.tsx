import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  getPreferenceValues,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";

import { cardTitle } from "../card-sorting";
import {
  analyzeBulkCards,
  checkBulkRegenerationAvailability,
  type BulkCardAnalysis,
} from "../domain/bulk-card-regeneration";
import { detectTemplateDrift, refreshTemplateSnapshot } from "../domain/mochi-template";
import type { CardTemplate, MochiTemplateSnapshot } from "../domain/template";
import {
  regenerateBulkCard,
  runBulkCardBatch,
  type BulkCardOperationStatus,
  type BulkCardOperationUpdate,
  type BulkCardResult,
} from "../services/bulk-card-regenerator";
import { MochiClient, toMochiTemplateSnapshot } from "../services/mochi-client";
import { RaycastAiClient } from "../services/raycast-ai-client";
import { CardCacheRepository, upsertCreatedCardBestEffort } from "../storage/card-cache-repository";
import { CardGenerationContextRepository } from "../storage/card-generation-context-repository";

type Preferences = { readonly mochiApiKey: string };

type BulkRegenerateCardsProps = {
  readonly template: CardTemplate;
  readonly templates: readonly CardTemplate[];
};

type AnalysisData = {
  readonly analysis: readonly BulkCardAnalysis[];
  readonly generationTemplate: CardTemplate;
  readonly liveMochiTemplate: MochiTemplateSnapshot;
};

type Progress = { readonly cardId: string; readonly number: number; readonly total: number };

const contextRepository = new CardGenerationContextRepository();
const cardCacheRepository = new CardCacheRepository();
const aiClient = new RaycastAiClient();

export function BulkRegenerateCards({ template, templates }: BulkRegenerateCardsProps) {
  const { mochiApiKey } = getPreferenceValues<Preferences>();
  const client = new MochiClient(mochiApiKey);
  const analysisAbortable = useRef<AbortController | undefined>(undefined);
  const activeController = useRef<AbortController | undefined>(undefined);
  const operationLock = useRef(false);
  const [statuses, setStatuses] = useState<Readonly<Record<string, BulkCardOperationUpdate>>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | undefined>(undefined);
  const { data, error, isLoading, revalidate } = usePromise(
    () => loadAnalysis(client, template, templates, analysisAbortable.current?.signal),
    [],
    { abortable: analysisAbortable }
  );

  useEffect(
    () => () => {
      activeController.current?.abort(new Error("Bulk regeneration screen closed"));
    },
    []
  );

  if (!data) {
    return (
      <List isLoading={isLoading} navigationTitle="Regenerate Cards">
        {error ? (
          <List.EmptyView
            icon={Icon.Warning}
            title="Could Not Analyze Cards"
            description={errorMessage(error)}
            actions={
              <ActionPanel>
                <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        ) : null}
      </List>
    );
  }

  const linked = readyCards(data.analysis, "linked");
  const inferred = readyCards(data.analysis, "inferred");
  const skipped = data.analysis.filter((item) => item.kind === "skipped");
  const ready = [...linked, ...inferred];
  const unfinishedIds = ready
    .filter((item) => statuses[item.card.id]?.status === "failed" || statuses[item.card.id]?.status === "cancelled")
    .map((item) => item.card.id);
  const summary = operationSummary(data.analysis, statuses);
  const currentCard = progress ? ready.find((item) => item.card.id === progress.cardId)?.card : undefined;

  async function start(cardIds: readonly string[], requireConfirmation: boolean): Promise<void> {
    if (operationLock.current || isRunning || cardIds.length === 0) {
      return;
    }
    operationLock.current = true;
    try {
      if (requireConfirmation) {
        const confirmed = await confirmAlert({
          icon: Icon.Warning,
          title: `Regenerate ${cardIds.length} Cards?`,
          message: `${linked.length} linked and ${inferred.length} inferred cards will be updated.\nGenerated fields, card content, and tags will be overwritten.\nUnmapped Mochi fields will be preserved.\n${skipped.length} cards will be skipped. This cannot be undone.`,
          primaryAction: { title: `Regenerate ${cardIds.length} Cards`, style: Alert.ActionStyle.Destructive },
        });
        if (!confirmed) {
          return;
        }
      }

      const controller = new AbortController();
      activeController.current = controller;
      setIsRunning(true);
      setProgress(undefined);
      const mutationSnapshot = await loadLiveTemplate(client, template, controller.signal);
      setStatuses((current) => ({
        ...current,
        ...Object.fromEntries(cardIds.map((cardId) => [cardId, { cardId, status: "pending" as const }])),
      }));
      const readyById = new Map(ready.map((item) => [item.card.id, item]));
      await runBulkCardBatch(
        cardIds,
        async (cardId, signal) => {
          const original = readyById.get(cardId);
          if (!original) {
            return { kind: "skipped", reason: "Card is no longer part of this operation." };
          }
          return reanalyzeAndRegenerate(client, original, mutationSnapshot, signal);
        },
        controller.signal,
        (update) => {
          setStatuses((current) => ({ ...current, [update.cardId]: update }));
          if (update.status === "running") {
            setProgress({ cardId: update.cardId, number: cardIds.indexOf(update.cardId) + 1, total: cardIds.length });
          }
        }
      );
    } catch (runError: unknown) {
      const controller = activeController.current;
      if (controller?.signal.aborted) {
        setStatuses((current) => ({
          ...current,
          ...Object.fromEntries(
            cardIds
              .filter((cardId) => !current[cardId] || ["pending", "running"].includes(current[cardId].status))
              .map((cardId) => [cardId, { cardId, status: "cancelled" as const, message: "Operation cancelled." }])
          ),
        }));
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Start Regeneration",
          message: errorMessage(runError),
        });
      }
    } finally {
      activeController.current = undefined;
      operationLock.current = false;
      setIsRunning(false);
      setProgress(undefined);
    }
  }

  async function reanalyzeAndRegenerate(
    mochiClient: MochiClient,
    original: Extract<BulkCardAnalysis, { readonly kind: "ready" }>,
    mutationSnapshot: Omit<AnalysisData, "analysis">,
    signal: AbortSignal
  ): Promise<BulkCardResult> {
    const freshCard = await mochiClient.getCard(original.card.id, signal);
    const contexts = await contextRepository.getMany([freshCard.id]);
    const freshAnalysis = analyzeBulkCards(mutationSnapshot.generationTemplate, [freshCard], contexts)[0];
    if (!freshAnalysis) {
      return { kind: "skipped", reason: "Card moved or now uses a different Mochi template." };
    }
    if (freshAnalysis.kind === "skipped") {
      return { kind: "skipped", reason: freshAnalysis.message };
    }
    return regenerateBulkCard(
      freshAnalysis,
      mutationSnapshot.generationTemplate,
      mutationSnapshot.liveMochiTemplate,
      {
        getCard: (cardId, operationSignal) => mochiClient.getCard(cardId, operationSignal),
        updateCard: (cardId, request, operationSignal) => mochiClient.updateCard(cardId, request, operationSignal),
        aiClient,
        saveContext: (context) => contextRepository.save(context),
        cacheCard: (card) => upsertCreatedCardBestEffort(cardCacheRepository, card.deckId, card),
      },
      signal
    );
  }

  const cancelAction = isRunning ? (
    <Action
      title="Cancel Current Operation"
      icon={Icon.Stop}
      style={Action.Style.Destructive}
      onAction={() => activeController.current?.abort(new Error("Operation cancelled"))}
    />
  ) : null;
  const primaryAction =
    !isRunning && ready.length > 0 ? (
      <Action
        title={`Regenerate ${ready.length} Cards`}
        icon={Icon.Repeat}
        onAction={() =>
          start(
            ready.map((item) => item.card.id),
            true
          )
        }
      />
    ) : null;
  const retryAction =
    !isRunning && unfinishedIds.length > 0 ? (
      <Action title="Retry Unfinished Cards" icon={Icon.ArrowClockwise} onAction={() => start(unfinishedIds, false)} />
    ) : null;

  return (
    <List
      isLoading={isLoading || isRunning}
      navigationTitle={
        progress
          ? `${currentCard ? cardTitle(currentCard) : "Regenerating Cards"} · ${progress.number} / ${progress.total}`
          : "Regenerate Cards"
      }
      searchBarPlaceholder="Search analyzed cards"
    >
      {summary ? <List.Section title={summary} /> : null}
      <AnalysisSection
        title="Ready — Linked"
        items={linked}
        statuses={statuses}
        primaryAction={primaryAction}
        retryAction={retryAction}
        cancelAction={cancelAction}
      />
      <AnalysisSection
        title="Ready — Inferred"
        items={inferred}
        statuses={statuses}
        primaryAction={primaryAction}
        retryAction={retryAction}
        cancelAction={cancelAction}
      />
      <AnalysisSection
        title="Skipped"
        items={skipped}
        statuses={statuses}
        primaryAction={null}
        retryAction={retryAction}
        cancelAction={cancelAction}
      />
      {data.analysis.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No Matching Cards"
          description="No cards in this deck currently use the configured Mochi template."
        />
      ) : null}
    </List>
  );
}

function AnalysisSection({
  title,
  items,
  statuses,
  primaryAction,
  retryAction,
  cancelAction,
}: {
  readonly title: string;
  readonly items: readonly BulkCardAnalysis[];
  readonly statuses: Readonly<Record<string, BulkCardOperationUpdate>>;
  readonly primaryAction: React.ReactNode;
  readonly retryAction: React.ReactNode;
  readonly cancelAction: React.ReactNode;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <List.Section title={title} subtitle={String(items.length)}>
      {items.map((item) => {
        const operation = statuses[item.card.id];
        const status = operation?.status ?? (item.kind === "ready" ? "pending" : "skipped");
        const message = operation?.message ?? (item.kind === "ready" ? statusLabel(status) : item.message);
        return (
          <List.Item
            key={item.card.id}
            icon={statusIcon(status)}
            title={cardTitle(item.card)}
            subtitle={message}
            accessories={[{ text: statusLabel(status) }]}
            actions={
              primaryAction || retryAction || cancelAction ? (
                <ActionPanel>
                  {primaryAction}
                  {retryAction}
                  {cancelAction}
                </ActionPanel>
              ) : undefined
            }
          />
        );
      })}
    </List.Section>
  );
}

async function loadAnalysis(
  client: MochiClient,
  template: CardTemplate,
  templates: readonly CardTemplate[],
  signal?: AbortSignal
): Promise<AnalysisData> {
  if (checkBulkRegenerationAvailability(template, templates).kind !== "available") {
    throw new Error("Bulk regeneration is no longer available for this Generation Template.");
  }
  const [snapshot, cards] = await Promise.all([
    loadLiveTemplate(client, template, signal),
    client.listCards(template.deckId, signal),
  ]);
  const candidateIds = cards
    .filter((card) => card.deckId === template.deckId && card.templateId === snapshot.liveMochiTemplate.id)
    .map((card) => card.id);
  const contexts = await contextRepository.getMany(candidateIds);
  return {
    ...snapshot,
    analysis: analyzeBulkCards(snapshot.generationTemplate, cards, contexts),
  };
}

async function loadLiveTemplate(
  client: MochiClient,
  template: CardTemplate,
  signal?: AbortSignal
): Promise<Omit<AnalysisData, "analysis">> {
  if (template.output.kind !== "mochi-template" || template.output.target.status !== "configured") {
    throw new Error("Generation Template is not configured for a Mochi template.");
  }
  const live = toMochiTemplateSnapshot(await client.getTemplate(template.output.target.template.id, signal));
  const drift = detectTemplateDrift(template.output.target.template, live, template.output.target.bindings);
  if (drift.length > 0) {
    throw new Error(`${drift[0].message}. Open Edit Template and update the field mappings first.`);
  }
  return {
    generationTemplate: {
      ...template,
      output: {
        kind: "mochi-template",
        target: {
          ...template.output.target,
          template: refreshTemplateSnapshot(template.output.target.template, live),
        },
      },
    },
    liveMochiTemplate: live,
  };
}

function readyCards(
  analysis: readonly BulkCardAnalysis[],
  source: "linked" | "inferred"
): readonly Extract<BulkCardAnalysis, { readonly kind: "ready" }>[] {
  return analysis.filter(
    (item): item is Extract<BulkCardAnalysis, { readonly kind: "ready" }> =>
      item.kind === "ready" && item.source === source
  );
}

export function operationSummary(
  analysis: readonly BulkCardAnalysis[],
  statuses: Readonly<Record<string, BulkCardOperationUpdate>>
): string | undefined {
  const terminal = Object.values(statuses).filter(
    (update) => update.status !== "pending" && update.status !== "running"
  );
  const skippedFromAnalysis = analysis.filter((item) => item.kind === "skipped").length;
  const readyCount = analysis.filter((item) => item.kind === "ready").length;
  if (terminal.length === 0 && (skippedFromAnalysis === 0 || readyCount > 0)) {
    return undefined;
  }
  const updated = terminal.filter(
    (update) => update.status === "updated" || update.status === "updated-with-warning"
  ).length;
  const failed = terminal.filter((update) => update.status === "failed").length;
  const skipped = skippedFromAnalysis + terminal.filter((update) => update.status === "skipped").length;
  const cancelled = terminal.filter((update) => update.status === "cancelled").length;
  return `${updated} updated · ${failed} failed · ${skipped} skipped · ${cancelled} cancelled`;
}

function statusIcon(status: BulkCardOperationStatus): Icon {
  switch (status) {
    case "pending":
      return Icon.Circle;
    case "running":
      return Icon.Hourglass;
    case "updated":
      return Icon.CheckCircle;
    case "updated-with-warning":
      return Icon.Warning;
    case "failed":
      return Icon.XMarkCircle;
    case "skipped":
      return Icon.MinusCircle;
    case "cancelled":
      return Icon.Stop;
  }
}

function statusLabel(status: BulkCardOperationStatus): string {
  return status === "updated-with-warning"
    ? "Updated with warning"
    : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Unexpected error";
}
