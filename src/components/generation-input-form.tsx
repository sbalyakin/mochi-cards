import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useEffect, useRef, useState } from "react";

import type { CardTemplate, VariableValues } from "../domain/template";
import { generateSession, getAiFieldErrors } from "../domain/generation-session";
import { RaycastAiClient } from "../services/raycast-ai-client";
import { CardPreview } from "./card-preview";

type GenerationInputFormProps = {
  readonly template: CardTemplate;
};

const aiClient = new RaycastAiClient();

export function GenerationInputForm({ template }: GenerationInputFormProps) {
  const { push } = useNavigation();
  const [values, setValues] = useState<VariableValues>(() =>
    Object.fromEntries(template.variables.map((variable) => [variable.name, ""]))
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
      template.variables
        .filter((variable) => variable.required && (values[variable.name] ?? "").trim().length === 0)
        .map((variable) => [variable.name, `${variable.label} is required`])
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
        text={`${template.name} · ${template.variables.length} variable${template.variables.length === 1 ? "" : "s"}`}
      />
      {template.variables.length === 0 ? (
        <Form.Description title="Input" text="This template has no variables. Generate it as-is." />
      ) : null}
      {template.variables.map((variable) => (
        <Form.TextArea
          key={variable.name}
          id={variable.name}
          title={variable.label}
          placeholder={variable.required ? "Required" : "Optional"}
          value={values[variable.name] ?? ""}
          error={errors[variable.name]}
          onChange={(value) => {
            setValues((current) => ({ ...current, [variable.name]: value }));
            if (errors[variable.name]) {
              setErrors((current) => {
                const remaining = { ...current };
                delete remaining[variable.name];
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
