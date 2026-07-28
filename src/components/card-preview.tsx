import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Detail,
  getPreferenceValues,
  Icon,
  launchCommand,
  LaunchType,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";

import { cardTitle } from "../card-sorting";
import { deriveMochiCardName, findDuplicateCardByName, selectDuplicateCandidate } from "../domain/card-duplicates";
import { cardChangedSinceOpen, mergeUpdateFields } from "../domain/edit-card";
import {
  editMarkdown,
  generateSession,
  generationFieldTitle,
  getAiFieldErrors,
  getGeneratedAiFields,
  getMochiOutput,
  isSessionReady,
  regenerateAll,
  regenerateField,
  renderMarkdown,
  restoreGenerated,
  type GenerationProgress,
  type GeneratedSession,
  type GenerationSession,
} from "../domain/generation-session";
import type { CardTemplate, FieldValues } from "../domain/template";
import { templateUsesAi, type AiClient } from "../domain/template-engine";
import { detectTemplateDrift, refreshTemplateSnapshot } from "../domain/mochi-template";
import { cardMarkdown } from "../mochi-card-content";
import { renderRaycastMarkdown } from "../raycast-markdown";
import {
  MochiClient,
  MochiError,
  toMochiTemplateSnapshot,
  type MochiCard,
  type MochiTemplate,
} from "../services/mochi-client";
import { createAiClient } from "../services/ai-client-factory";
import { displayAiModelName } from "../services/ai-model-display-name";
import { AiProviderError } from "../services/ai-provider";
import { aiSettingsRepository } from "../services/raycast-ai-settings-repository";
import { CardCacheRepository, upsertCreatedCardBestEffort } from "../storage/card-cache-repository";
import { CardGenerationContextRepository } from "../storage/card-generation-context-repository";
import { CardPreviewSettingsRepository } from "../storage/card-preview-settings-repository";
import { MarkdownEditor } from "./markdown-editor";
import { MochiValuesEditor } from "./mochi-values-editor";
import { SaveMarkdownForm } from "./save-markdown-form";

type CardPreviewProps = {
  readonly template: CardTemplate;
  readonly values: FieldValues;
  readonly mode:
    | {
        readonly kind: "create";
        readonly onCardAdded: (card?: MochiCard) => Promise<void> | void;
        readonly returnToSourceAfterCardAdded?: boolean;
      }
    | {
        readonly kind: "update";
        readonly card: MochiCard;
        readonly onBack: () => void;
        readonly backTitle?: string;
        readonly onCardUpdated: (card: MochiCard, template: MochiTemplate, signal: AbortSignal) => Promise<void> | void;
      };
};

type Preferences = { readonly mochiApiKey: string };

const cardCacheRepository = new CardCacheRepository();
const contextRepository = new CardGenerationContextRepository();
const cardPreviewSettingsRepository = new CardPreviewSettingsRepository();

export function CardPreview({ template, values, mode }: CardPreviewProps) {
  const { pop } = useNavigation();
  const [session, setSession] = useState<GenerationSession | undefined>(undefined);
  const [previewMochiTemplate, setPreviewMochiTemplate] = useState<MochiTemplate | undefined>(undefined);
  const [isWorking, setIsWorking] = useState(true);
  const [generationFailure, setGenerationFailure] = useState<string | undefined>(undefined);
  const [creationLog, setCreationLog] = useState<readonly string[]>([]);
  const [isShowingMetadata, setIsShowingMetadata] = useState(false);
  const hasChangedMetadataPreference = useRef(false);
  const operationNumber = useRef(0);
  const activeController = useRef<AbortController | undefined>(undefined);
  const markdown = session ? renderMarkdown(session) : "";
  const previewMarkdown =
    session && previewMochiTemplate
      ? renderMochiTemplatePreview(session, previewMochiTemplate, mode)
      : renderRaycastMarkdown(markdown);
  const creationMarkdown = creationLog.join("  \n");
  const fieldErrors = session ? getAiFieldErrors(session) : [];
  const isCardBodySession = session
    ? (session.mode === "generated" ? session.output.kind : session.output.kind) === "card-body"
    : template.output.kind === "card-body";
  const ready = session !== undefined && isSessionReady(session) && (!isCardBodySession || markdown.trim().length > 0);
  const duplicateCandidate =
    session && mode.kind === "create" ? selectDuplicateCandidate(template, values, "create", markdown) : undefined;
  const duplicate = duplicateCandidate
    ? findDuplicateCardByName(cardCacheRepository.get(template.deckId), duplicateCandidate)
    : undefined;
  const { data: savedIsShowingMetadata } = usePromise(() => cardPreviewSettingsRepository.getShowMetadata(), [], {
    async onError(error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Load Preview Details Setting",
        message: errorMessage(error),
      });
    },
  });

  useEffect(() => {
    if (savedIsShowingMetadata === undefined || hasChangedMetadataPreference.current) {
      return;
    }
    setIsShowingMetadata(savedIsShowingMetadata);
  }, [savedIsShowingMetadata]);

  function toggleMetadata(): void {
    const nextIsShowingMetadata = !isShowingMetadata;
    hasChangedMetadataPreference.current = true;
    setIsShowingMetadata(nextIsShowingMetadata);
    void cardPreviewSettingsRepository.saveShowMetadata(nextIsShowingMetadata).catch((error: unknown) => {
      void showToast({
        style: Toast.Style.Failure,
        title: "Could Not Save Preview Details Setting",
        message: errorMessage(error),
      });
    });
  }

  useEffect(() => {
    let aiModelName: string | undefined;
    const logProgress = (progress: GenerationProgress): void => {
      setCreationLog((current) => [...current, generationProgressMessage(progress, aiModelName)]);
    };

    async function generateInitialSession(controller: AbortController): Promise<void> {
      try {
        setGenerationFailure(undefined);
        const preferences = getPreferenceValues<Preferences>();
        let generationTemplate = template;
        let livePreviewTemplate: MochiTemplate | undefined;
        if (template.output.kind === "mochi-template") {
          if (template.output.target.status === "needs-configuration") {
            throw new Error("Mochi template mappings need configuration");
          }
          const liveTemplate = await new MochiClient(preferences.mochiApiKey).getTemplate(
            template.output.target.template.id,
            controller.signal
          );
          const live = toMochiTemplateSnapshot(liveTemplate);
          const drift = detectTemplateDrift(template.output.target.template, live, template.output.target.bindings);
          if (drift.length > 0) {
            throw new Error(`${drift[0].message}. Edit the local template mappings.`);
          }
          generationTemplate = {
            ...template,
            output: {
              kind: "mochi-template",
              target: {
                ...template.output.target,
                template: refreshTemplateSnapshot(template.output.target.template, live),
              },
            },
          };
          livePreviewTemplate = liveTemplate;
        }

        const aiSettings = templateUsesAi(generationTemplate) ? await aiSettingsRepository.get() : undefined;
        aiModelName = aiSettings ? displayAiModelName(aiSettings) : undefined;
        const aiClient = aiSettings ? createAiClient(aiSettings) : undefined;
        const generated = await generateSession(generationTemplate, values, aiClient, controller.signal, logProgress);
        if (controller.signal.aborted) {
          return;
        }
        const errors = getAiFieldErrors(generated);
        setPreviewMochiTemplate(livePreviewTemplate);
        setSession(generated);
        if (errors.length > 0) {
          const message = errors.map((error) => error.message).join("; ");
          setGenerationFailure(message);
          return;
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Could not generate card",
            message: errorMessage(error),
            primaryAction: aiPreferencesAction(error),
          });
          if (controller.signal.aborted) {
            return;
          }
          if (mode.kind === "create") {
            pop();
          } else {
            mode.onBack();
          }
        }
      } finally {
        if (activeController.current === controller) {
          activeController.current = undefined;
          setIsWorking(false);
        }
      }
    }

    let controller: AbortController | undefined;
    const startTimer = setTimeout(() => {
      controller = new AbortController();
      activeController.current = controller;
      void generateInitialSession(controller);
    }, 0);

    return () => {
      clearTimeout(startTimer);
      controller?.abort(new Error("Preview closed"));
      activeController.current?.abort(new Error("Preview closed"));
    };
  }, [template, values]);

  async function runRegeneration(
    title: string,
    operation: (generated: GeneratedSession, aiClient: AiClient, signal: AbortSignal) => Promise<GeneratedSession>
  ): Promise<void> {
    if (!session || session.mode !== "generated" || activeController.current) {
      return;
    }

    const generated = session;
    const controller = new AbortController();
    const currentOperation = operationNumber.current + 1;
    operationNumber.current = currentOperation;
    activeController.current = controller;
    setIsWorking(true);
    try {
      const aiClient = createAiClient(await aiSettingsRepository.get());
      const updated = await operation(generated, aiClient, controller.signal);
      if (operationNumber.current !== currentOperation) {
        return;
      }
      setSession(updated);
      const errors = getAiFieldErrors(updated);
      if (errors.length === 0) {
        setGenerationFailure(undefined);
        await showToast({ style: Toast.Style.Success, title });
      } else {
        const message = errors.map((error) => error.message).join("; ");
        setGenerationFailure(message);
        setCreationLog((current) => [...current, `⚠️ AI field regeneration failed: ${message}`]);
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Regeneration failed",
          message: errorMessage(error),
          primaryAction: aiPreferencesAction(error),
        });
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = undefined;
        setIsWorking(false);
      }
    }
  }

  async function saveToMochi(): Promise<void> {
    if (!ready || activeController.current) {
      return;
    }

    const controller = new AbortController();
    activeController.current = controller;
    setIsWorking(true);
    try {
      const { mochiApiKey } = getPreferenceValues<Preferences>();
      const mochiOutput = getMochiOutput(session);
      const client = new MochiClient(mochiApiKey);
      if (mode.kind === "create") {
        if (!mochiOutput) {
          const candidateName = deriveMochiCardName(markdown);
          const duplicate = findDuplicateCardByName(cardCacheRepository.get(template.deckId), candidateName);
          if (duplicate) {
            const confirmed = await confirmAlert({
              icon: Icon.Warning,
              title: "Card Already Exists",
              message: `A card named "${duplicate.name}" already exists in this deck. Create another one?`,
              primaryAction: { title: "Create Duplicate", style: Alert.ActionStyle.Destructive },
            });
            if (controller.signal.aborted || !confirmed) {
              return;
            }
          }
        }
        if (mochiOutput) {
          if (!previewMochiTemplate || previewMochiTemplate.id !== mochiOutput.templateId) {
            throw new Error("Live Mochi template is unavailable");
          }
          if (template.output.kind !== "mochi-template" || template.output.target.status !== "configured") {
            throw new Error("Mochi template mappings need configuration");
          }
          const currentMochiTemplate = await client.getTemplate(mochiOutput.templateId, controller.signal);
          const drift = detectTemplateDrift(
            toMochiTemplateSnapshot(previewMochiTemplate),
            toMochiTemplateSnapshot(currentMochiTemplate),
            template.output.target.bindings
          );
          if (drift.length > 0) {
            throw new Error(`${drift[0].message}. Edit the local template mappings.`);
          }
        }
        const card = await client.createCard(
          {
            deckId: template.deckId,
            tags: template.tags,
            reviewReverse: template.reviewReverse,
            archived: template.archived,
            output: mochiOutput
              ? { kind: "mochi-template", templateId: mochiOutput.templateId, fields: mochiOutput.fields }
              : { kind: "card-body", content: markdown, templateMode: cardBodyTemplateMode(template) },
          },
          controller.signal
        );
        const createdCard = await cacheCreatedCardBestEffort(client, template.deckId, card, controller.signal);
        await showToast({
          style: Toast.Style.Success,
          title: `Card added: ${createdCard ? cardTitle(createdCard) : card.name?.trim() || deriveMochiCardName(markdown)}`,
        });
        if (card.id && mochiOutput) {
          await saveContextWithWarning(card.id, template, values, mochiOutput.templateId, controller.signal);
        } else if (mochiOutput) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Card Added, but Edit Context Was Not Saved",
            message: "Mochi did not return a card ID, so this card's generation inputs cannot be restored later.",
          });
        }
        await mode.onCardAdded(createdCard);
        if (mode.returnToSourceAfterCardAdded) {
          pop();
          setTimeout(pop, 0);
          return;
        }
        pop();
      } else {
        if (!mochiOutput) {
          throw new Error("Edit Card requires a Mochi template output");
        }
        if (!previewMochiTemplate || previewMochiTemplate.id !== mochiOutput.templateId) {
          throw new Error("Live Mochi template is unavailable");
        }
        if (template.output.kind !== "mochi-template" || template.output.target.status !== "configured") {
          throw new Error("Edit Card requires configured Mochi template mappings");
        }
        let comparisonCard = mode.card;
        let current: MochiCard;
        let currentMochiTemplate: MochiTemplate;
        while (true) {
          [current, currentMochiTemplate] = await Promise.all([
            client.getCard(mode.card.id, controller.signal),
            client.getTemplate(mochiOutput.templateId, controller.signal),
          ]);
          const drift = detectTemplateDrift(
            toMochiTemplateSnapshot(previewMochiTemplate),
            toMochiTemplateSnapshot(currentMochiTemplate),
            template.output.target.bindings
          );
          if (drift.length > 0) {
            throw new Error(`${drift[0].message}. Edit the local template mappings.`);
          }
          if (current.deckId !== mode.card.deckId) {
            throw new Error("Card moved to another Mochi deck. Reopen it from the new deck before editing.");
          }
          if (comparisonCard.templateId !== current.templateId) {
            const changesTemplate = current.templateId !== mochiOutput.templateId;
            const confirmed = await confirmAlert({
              icon: Icon.Warning,
              title: "Card Template Changed in Mochi",
              message: changesTemplate
                ? `The card now uses a different template. Continuing will switch it to "${currentMochiTemplate.name}" and replace its fields.`
                : "The card now uses this edit session's template. Overwrite its latest fields?",
              primaryAction: {
                title: changesTemplate ? "Switch Template and Overwrite" : "Overwrite New Template",
                style: Alert.ActionStyle.Destructive,
              },
            });
            if (controller.signal.aborted || !confirmed) {
              return;
            }
            comparisonCard = current;
            continue;
          }
          if (!cardChangedSinceOpen(comparisonCard, current)) {
            break;
          }
          const confirmed = await confirmAlert({
            icon: Icon.Warning,
            title: "Card Changed in Mochi",
            message: "The card changed after editing started. Overwrite generated fields on top of the latest version?",
            primaryAction: { title: "Overwrite Latest", style: Alert.ActionStyle.Destructive },
          });
          if (controller.signal.aborted || !confirmed) {
            return;
          }
          comparisonCard = current;
        }
        const currentFieldIds = new Set(currentMochiTemplate.fields.map((field) => field.id));
        const fields = Object.fromEntries(
          Object.entries(mergeUpdateFields(current, mochiOutput.templateId, mochiOutput.fields)).filter(([id]) =>
            currentFieldIds.has(id)
          )
        );
        await client.updateCard(
          mode.card.id,
          { templateId: mochiOutput.templateId, fields, tags: template.tags },
          controller.signal
        );
        let updatedCard: MochiCard = {
          ...current,
          content: "",
          templateId: mochiOutput.templateId,
          tags: template.tags,
          fields: Object.entries(fields).map(([id, value]) => ({ id, value })),
        };
        let refreshError: unknown;
        try {
          updatedCard = await client.getCard(mode.card.id, controller.signal);
        } catch (error: unknown) {
          refreshError = error;
        }
        if (controller.signal.aborted) {
          return;
        }
        await showToast(
          refreshError
            ? {
                style: Toast.Style.Failure,
                title: `Card updated: ${cardTitle(updatedCard)} (refresh failed)`,
                message: mochiErrorMessage(refreshError),
              }
            : { style: Toast.Style.Success, title: `Card updated: ${cardTitle(updatedCard)}` }
        );
        if (controller.signal.aborted) {
          return;
        }
        await saveContextWithWarning(mode.card.id, template, values, mochiOutput.templateId, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        await mode.onCardUpdated(updatedCard, currentMochiTemplate, controller.signal);
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        await showToast({
          style: Toast.Style.Failure,
          title: mode.kind === "create" ? "Could not add card to Mochi" : "Could not update card in Mochi",
          message: mochiErrorMessage(error),
        });
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = undefined;
        setIsWorking(false);
      }
    }
  }

  const generatedSession = session?.mode === "generated" ? session : undefined;
  const manuallyEditedSession = session?.mode === "manually-edited" ? session : undefined;
  const failedAiFields = generatedSession
    ? getGeneratedAiFields(generatedSession).filter((field) => field.result.status === "error")
    : [];
  const retryableAiFields =
    failedAiFields.length > 0 ? failedAiFields : generatedSession ? getGeneratedAiFields(generatedSession) : [];
  const visibleTags = template.tags;
  function leavePreview(): void {
    activeController.current?.abort(new Error("Preview closed"));
    if (mode.kind === "create") {
      pop();
    } else {
      mode.onBack();
    }
  }

  return (
    <Detail
      isLoading={isWorking}
      navigationTitle={
        generationFailure
          ? "Generation Failed"
          : session
            ? "Card Preview"
            : mode.kind === "create"
              ? "Generating Card"
              : "Regenerating Card"
      }
      markdown={session && !generationFailure ? previewMarkdown || "_No generated content yet._" : creationMarkdown}
      metadata={
        isShowingMetadata ? (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Template" text={template.name} icon={Icon.Snippets} />
            <Detail.Metadata.Label title="Deck" text={template.deckName} icon={Icon.Book} />
            {duplicate ? (
              <Detail.Metadata.Label
                title="Duplicate"
                text={`A card for "${duplicate.name}" already exists`}
                icon="⚠️"
              />
            ) : null}
            {visibleTags.length > 0 ? (
              <Detail.Metadata.TagList title="Tags">
                {visibleTags.map((tag) => (
                  <Detail.Metadata.TagList.Item key={tag} text={tag} />
                ))}
              </Detail.Metadata.TagList>
            ) : null}
            {fieldErrors.length > 0 ? <Detail.Metadata.Separator /> : null}
            {fieldErrors.map((error) => (
              <Detail.Metadata.Label
                key={error.id}
                title={generationFieldTitle(session, error.id)}
                text={error.message}
                icon={Icon.Warning}
              />
            ))}
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          {session && !generationFailure ? (
            <>
              {ready ? (
                <Action
                  title={mode.kind === "create" ? "Add to Mochi" : "Update Card in Mochi"}
                  icon={Icon.Upload}
                  onAction={saveToMochi}
                />
              ) : null}
              {generatedSession?.output.kind === "card-body" ? (
                <Action.Push
                  title="Edit Markdown"
                  icon={Icon.Pencil}
                  target={
                    <MarkdownEditor
                      initialMarkdown={markdown}
                      onSave={(editedMarkdown) => setSession(editMarkdown(generatedSession, editedMarkdown))}
                    />
                  }
                />
              ) : generatedSession?.output.kind === "mochi-template" ? (
                <Action.Push
                  title="Edit Field Values"
                  icon={Icon.Pencil}
                  target={<MochiValuesEditor session={generatedSession} onSave={setSession} />}
                />
              ) : (
                <Action
                  title="Restore Generated Version"
                  icon={Icon.Undo}
                  onAction={() => {
                    if (manuallyEditedSession) {
                      setSession(restoreGenerated(manuallyEditedSession));
                    }
                  }}
                />
              )}
              <Action
                title={isShowingMetadata ? "Hide Details" : "Show Details"}
                icon={isShowingMetadata ? Icon.EyeDisabled : Icon.Eye}
                shortcut={{ modifiers: ["cmd"], key: "d" }}
                onAction={toggleMetadata}
              />
              {generatedSession && getGeneratedAiFields(generatedSession).length > 0 ? (
                <>
                  <Action
                    title="Regenerate All AI Fields"
                    icon={Icon.Repeat}
                    onAction={() =>
                      runRegeneration("All AI fields regenerated", (generated, aiClient, signal) =>
                        regenerateAll(generated, aiClient, signal)
                      )
                    }
                  />
                  <ActionPanel.Submenu title="Regenerate AI Field" icon={Icon.Wand}>
                    {getGeneratedAiFields(generatedSession).map((field) => (
                      <Action
                        key={field.id}
                        title={generationFieldTitle(generatedSession, field.id)}
                        icon={field.result.status === "error" ? Icon.Warning : Icon.Stars}
                        onAction={() =>
                          runRegeneration(
                            `${generationFieldTitle(generatedSession, field.id)} regenerated`,
                            (generated, aiClient, signal) => regenerateField(generated, field.id, aiClient, signal)
                          )
                        }
                      />
                    ))}
                  </ActionPanel.Submenu>
                </>
              ) : null}
              <Action
                title={mode.kind === "update" ? (mode.backTitle ?? "Back to Input") : "Back to Input"}
                icon={Icon.ArrowLeft}
                onAction={leavePreview}
              />
              {isCardBodySession ? <Action.CopyToClipboard title="Copy Markdown" content={markdown} /> : null}
              {isCardBodySession ? (
                <Action.Push
                  title="Save as Markdown File"
                  icon={Icon.SaveDocument}
                  target={<SaveMarkdownForm markdown={markdown} suggestedName={template.name} />}
                />
              ) : null}
              {isWorking ? (
                <Action
                  title="Cancel Current Operation"
                  icon={Icon.Stop}
                  onAction={() => activeController.current?.abort(new Error("Operation cancelled"))}
                />
              ) : null}
            </>
          ) : generationFailure && generatedSession ? (
            <>
              <ActionPanel.Submenu title="Retry Failed AI Field" icon={Icon.Repeat}>
                {retryableAiFields.map((field) => (
                  <Action
                    key={field.id}
                    title={generationFieldTitle(generatedSession, field.id)}
                    icon={Icon.Warning}
                    onAction={() =>
                      runRegeneration(
                        `${generationFieldTitle(generatedSession, field.id)} regenerated`,
                        (generated, aiClient, signal) => regenerateField(generated, field.id, aiClient, signal)
                      )
                    }
                  />
                ))}
              </ActionPanel.Submenu>
              <Action title="Back to Input" icon={Icon.ArrowLeft} onAction={leavePreview} />
            </>
          ) : (
            <Action
              title={generationFailure ? "Back to Input" : mode.kind === "create" ? "Cancel Creation" : "Cancel Update"}
              icon={Icon.Stop}
              onAction={leavePreview}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

function renderMochiTemplatePreview(
  session: GenerationSession,
  template: MochiTemplate,
  mode: CardPreviewProps["mode"]
): string {
  const output = getMochiOutput(session);
  if (!output || output.templateId !== template.id) {
    return renderRaycastMarkdown(renderMarkdown(session));
  }
  const values =
    mode.kind === "update" ? mergeUpdateFields(mode.card, output.templateId, output.fields) : output.fields;
  const card: MochiCard = {
    ...(mode.kind === "update"
      ? mode.card
      : {
          id: "preview",
          deckId: "",
          name: null,
          tags: [],
          reviews: [],
          aiCacheEntries: [],
        }),
    content: "",
    templateId: output.templateId,
    fields: Object.entries(values).map(([id, value]) => ({ id, value })),
    aiCacheEntries:
      mode.kind === "update" && mode.card.templateId === output.templateId ? mode.card.aiCacheEntries : [],
  };
  return cardMarkdown(card, template);
}

async function cacheCreatedCardBestEffort(
  client: MochiClient,
  deckId: string,
  card: { readonly id?: string; readonly name?: string | null },
  signal: AbortSignal
): Promise<MochiCard | undefined> {
  if (card.id === undefined) {
    return undefined;
  }
  if (card.name !== undefined) {
    upsertCreatedCardBestEffort(cardCacheRepository, deckId, card);
  }
  try {
    const createdCard = await client.getCard(card.id, signal);
    if (!signal.aborted) {
      upsertCreatedCardBestEffort(cardCacheRepository, deckId, { id: createdCard.id, name: createdCard.name });
      return createdCard;
    }
  } catch {
    // The card was added to Mochi. Updating the local card cache is best-effort.
  }
  return undefined;
}

async function saveContextWithWarning(
  cardId: string,
  template: CardTemplate,
  values: FieldValues,
  mochiTemplateId: string,
  signal: AbortSignal
): Promise<void> {
  try {
    await contextRepository.save({
      cardId,
      generationTemplateId: template.id,
      generationTemplateUpdatedAt: template.updatedAt,
      mochiTemplateId,
      inputValues: values,
    });
  } catch (error: unknown) {
    if (!signal.aborted) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Card saved, but edit context was not",
        message: errorMessage(error),
      });
    }
  }
}

function generationProgressMessage(progress: GenerationProgress, modelName?: string): string {
  switch (progress.kind) {
    case "substituting-fields":
      return "Substituting field values into template...";
    case "generating-ai-fields":
      return `Generating ${progress.total} AI field${progress.total === 1 ? "" : "s"}${modelName ? ` with ${modelName}` : ""}...`;
    case "ai-field-finished":
      return progress.succeeded
        ? `AI field ${progress.number}/${progress.total} generated...`
        : `⚠️ AI field ${progress.number}/${progress.total} failed: ${progress.errorMessage ?? "AI request failed"}`;
    case "rendering-preview":
      return "Rendering card preview...";
    default:
      return assertNever(progress);
  }
}

function mochiErrorMessage(error: unknown): string {
  if (error instanceof MochiError && error.kind === "unauthorized") {
    return "Check the Mochi API key in extension preferences.";
  }
  return errorMessage(error);
}

function cardBodyTemplateMode(template: CardTemplate): "none" | "deck-default" {
  if (template.output.kind !== "card-body") {
    throw new Error("Card Body output requires a card-body template mode");
  }
  return template.output.templateMode;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function aiPreferencesAction(error: unknown): Toast.ActionOptions | undefined {
  if (!(error instanceof AiProviderError) || (error.kind !== "configuration" && error.kind !== "authentication")) {
    return undefined;
  }
  return {
    title: "Configure AI Provider",
    onAction: () => launchCommand({ name: "configure-ai", type: LaunchType.UserInitiated }),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected progress event: ${JSON.stringify(value)}`);
}
