import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useEffect, useRef, useState } from "react";

import type { CardTemplate, FieldValues } from "../domain/template";
import { generateSession, getAiFieldErrors } from "../domain/generation-session";
import { RaycastAiClient } from "../services/raycast-ai-client";
import { CardPreview } from "./card-preview";

type GenerationInputFormProps = {
  readonly template: CardTemplate;
};

const aiClient = new RaycastAiClient();

export function GenerationInputForm({ template }: GenerationInputFormProps) {
  const { push } = useNavigation();
  const [values, setValues] = useState<FieldValues>(() =>
    Object.fromEntries(template.fields.map((field) => [field.name, ""]))
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const activeController = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => {
      activeController.current?.abort(new Error("Input closed"));
    },
    []
  );

  async function generate(): Promise<void> {
    if (activeController.current) {
      return;
    }

    const nextErrors = Object.fromEntries(
      template.fields
        .filter((field) => field.required && (values[field.name] ?? "").trim().length === 0)
        .map((field) => [field.name, `${field.name} is required`])
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      await showToast({ style: Toast.Style.Failure, title: "Fill in the required fields" });
      return;
    }

    const controller = new AbortController();
    activeController.current = controller;
    setIsGenerating(true);
    try {
      const session = await generateSession(template, values, aiClient, controller.signal);
      const fieldErrors = getAiFieldErrors(session);
      push(<CardPreview template={template} initialSession={session} />);
      if (fieldErrors.length > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: `${fieldErrors.length} AI field${fieldErrors.length === 1 ? "" : "s"} failed`,
          message: "Successful fields were kept. Retry the failed fields from the preview.",
        });
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        await showToast({ style: Toast.Style.Failure, title: "Could not generate card", message: errorMessage(error) });
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = undefined;
        setIsGenerating(false);
      }
    }
  }

  return (
    <Form
      isLoading={isGenerating}
      navigationTitle={template.name}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Generate Card" icon={Icon.Stars} onSubmit={generate} />
          {isGenerating ? (
            <Action
              title="Cancel Generation"
              icon={Icon.Stop}
              onAction={() => activeController.current?.abort(new Error("Generation cancelled"))}
            />
          ) : null}
        </ActionPanel>
      }
    >
      <Form.Description
        title="Template"
        text={`${template.name} · ${template.fields.length} field${template.fields.length === 1 ? "" : "s"}`}
      />
      {template.fields.length === 0 ? (
        <Form.Description title="Input" text="This template has no fields. Generate it as-is." />
      ) : null}
      {template.fields.map((field) => (
        <Form.TextArea
          key={field.name}
          id={field.name}
          title={field.name}
          placeholder={field.required ? "Required" : "Optional"}
          value={values[field.name] ?? ""}
          error={errors[field.name]}
          onChange={(value) => {
            setValues((current) => ({ ...current, [field.name]: value }));
            if (errors[field.name]) {
              setErrors((current) => {
                const remaining = { ...current };
                delete remaining[field.name];
                return remaining;
              });
            }
          }}
        />
      ))}
    </Form>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
