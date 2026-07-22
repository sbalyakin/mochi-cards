import { Action, ActionPanel, Detail, getPreferenceValues, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useEffect, useRef, useState } from "react";

import {
  editMarkdown,
  getAiFieldErrors,
  getGeneratedAiFields,
  isSessionReady,
  regenerateAll,
  regenerateField,
  renderMarkdown,
  restoreGenerated,
  type GeneratedSession,
  type GenerationSession,
} from "../domain/generation-session";
import type { CardTemplate } from "../domain/template";
import { MochiClient, MochiError } from "../services/mochi-client";
import { RaycastAiClient } from "../services/raycast-ai-client";
import { MarkdownEditor } from "./markdown-editor";
import { SaveMarkdownForm } from "./save-markdown-form";

type CardPreviewProps = {
  readonly template: CardTemplate;
  readonly initialSession: GeneratedSession;
};

type Preferences = {
  readonly mochiApiKey: string;
};

const aiClient = new RaycastAiClient();

export function CardPreview({ template, initialSession }: CardPreviewProps) {
  const { pop } = useNavigation();
  const [session, setSession] = useState<GenerationSession>(initialSession);
  const [isWorking, setIsWorking] = useState(false);
  const operationNumber = useRef(0);
  const activeController = useRef<AbortController | undefined>(undefined);
  const markdown = renderMarkdown(session);
  const fieldErrors = getAiFieldErrors(session);
  const ready = isSessionReady(session) && markdown.trim().length > 0;

  useEffect(
    () => () => {
      activeController.current?.abort(new Error("Preview closed"));
    },
    []
  );

  async function runRegeneration(
    title: string,
    operation: (generated: GeneratedSession, signal: AbortSignal) => Promise<GeneratedSession>
  ): Promise<void> {
    if (session.mode !== "generated" || activeController.current) {
      return;
    }

    const generated = session;
    const controller = new AbortController();
    const currentOperation = operationNumber.current + 1;
    operationNumber.current = currentOperation;
    activeController.current = controller;
    setIsWorking(true);
    try {
      const updated = await operation(generated, controller.signal);
      if (operationNumber.current !== currentOperation) {
        return;
      }
      setSession(updated);
      const errors = getAiFieldErrors(updated);
      await showToast({
        style: errors.length === 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: errors.length === 0 ? title : `${errors.length} AI field${errors.length === 1 ? "" : "s"} failed`,
        message: errors.length === 0 ? undefined : "Successful responses were kept. Retry the failed fields.",
      });
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        await showToast({ style: Toast.Style.Failure, title: "Regeneration failed", message: errorMessage(error) });
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = undefined;
        setIsWorking(false);
      }
    }
  }

  async function addToMochi(): Promise<void> {
    if (!ready || activeController.current) {
      return;
    }

    const controller = new AbortController();
    activeController.current = controller;
    setIsWorking(true);
    try {
      const { mochiApiKey } = getPreferenceValues<Preferences>();
      const card = await new MochiClient(mochiApiKey).createCard(markdown, template, controller.signal);
      await showToast({
        style: Toast.Style.Success,
        title: "Card added to Mochi",
        message: card.id ? `Card ID: ${card.id}` : template.name,
      });
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not add card to Mochi",
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

  const generatedSession = session.mode === "generated" ? session : undefined;
  const manuallyEditedSession = session.mode === "manually-edited" ? session : undefined;
  const status =
    session.mode === "manually-edited" ? "Manually edited" : fieldErrors.length > 0 ? "Needs attention" : "Ready";

  return (
    <Detail
      isLoading={isWorking}
      navigationTitle={`${template.name} Preview`}
      markdown={markdown || "_No generated content yet._"}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Template" text={template.name} icon={Icon.Document} />
          <Detail.Metadata.Label title="Deck" text={template.deckId} />
          <Detail.Metadata.Label
            title="Status"
            text={status}
            icon={fieldErrors.length > 0 ? Icon.Warning : Icon.CheckCircle}
          />
          {template.tags.length > 0 ? (
            <Detail.Metadata.TagList title="Tags">
              {template.tags.map((tag) => (
                <Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </Detail.Metadata.TagList>
          ) : null}
          {fieldErrors.length > 0 ? <Detail.Metadata.Separator /> : null}
          {fieldErrors.map((error) => (
            <Detail.Metadata.Label
              key={error.id}
              title={fieldTitle(error.id)}
              text={error.message}
              icon={Icon.Warning}
            />
          ))}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {ready ? <Action title="Add to Mochi" icon={Icon.Upload} onAction={addToMochi} /> : null}
          {generatedSession ? (
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
          {generatedSession ? (
            <>
              <Action
                title="Regenerate All AI Fields"
                icon={Icon.Repeat}
                onAction={() =>
                  runRegeneration("All AI fields regenerated", (generated, signal) =>
                    regenerateAll(generated, aiClient, signal)
                  )
                }
              />
              {getGeneratedAiFields(generatedSession).length > 0 ? (
                <ActionPanel.Submenu title="Regenerate AI Field" icon={Icon.Wand}>
                  {getGeneratedAiFields(generatedSession).map((field) => (
                    <Action
                      key={field.id}
                      title={fieldTitle(field.id)}
                      icon={field.result.status === "error" ? Icon.Warning : Icon.Stars}
                      onAction={() =>
                        runRegeneration(`${fieldTitle(field.id)} regenerated`, (generated, signal) =>
                          regenerateField(generated, field.id, aiClient, signal)
                        )
                      }
                    />
                  ))}
                </ActionPanel.Submenu>
              ) : null}
            </>
          ) : null}
          <Action title="Back to Input" icon={Icon.ArrowLeft} onAction={pop} />
          <Action.CopyToClipboard title="Copy Markdown" content={markdown} />
          <Action.Push
            title="Save as Markdown File"
            icon={Icon.SaveDocument}
            target={<SaveMarkdownForm markdown={markdown} suggestedName={template.name} />}
          />
          {isWorking ? (
            <Action
              title="Cancel Current Operation"
              icon={Icon.Stop}
              onAction={() => activeController.current?.abort(new Error("Operation cancelled"))}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

function fieldTitle(id: string): string {
  const number = id.replace("ai-field-", "");
  return `AI Field ${number}`;
}

function mochiErrorMessage(error: unknown): string {
  if (error instanceof MochiError && error.kind === "unauthorized") {
    return "Check the Mochi API key in extension preferences.";
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
