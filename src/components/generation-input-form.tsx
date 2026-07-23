import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";

import type { CardTemplate, FieldValues } from "../domain/template";
import { CardPreview } from "./card-preview";

type GenerationInputFormProps = {
  readonly template: CardTemplate;
};

export function GenerationInputForm({ template }: GenerationInputFormProps) {
  const { push } = useNavigation();
  const [values, setValues] = useState<FieldValues>(() =>
    Object.fromEntries(template.fields.map((field) => [field.id, field.type === "boolean" ? false : ""]))
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  function resetInput(): void {
    setValues(Object.fromEntries(template.fields.map((field) => [field.id, field.type === "boolean" ? false : ""])));
    setErrors({});
  }

  async function generate(): Promise<void> {
    const nextErrors = Object.fromEntries(
      template.fields.flatMap((field) => {
        const value = values[field.id];
        if (field.type === "boolean") {
          return [];
        }
        const text = typeof value === "string" ? value : "";
        if (field.required && text.trim().length === 0) {
          return [[field.id, `${field.name} is required`]];
        }
        if (field.type === "number" && text.trim() && !Number.isFinite(Number(text))) {
          return [[field.id, `${field.name} must be a finite number`]];
        }
        return [];
      })
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      await showToast({ style: Toast.Style.Failure, title: "Fill in the required fields" });
      return;
    }

    push(<CardPreview template={template} values={values} onCardAdded={resetInput} />);
  }

  return (
    <Form
      navigationTitle={template.name}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Card" icon={Icon.Stars} onSubmit={generate} />
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
      {template.fields.map((field) => {
        if (field.type === "boolean") {
          return (
            <Form.Checkbox
              key={field.id}
              id={field.id}
              title={field.name}
              label="Enabled"
              value={values[field.id] === true}
              onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            />
          );
        }
        const props = {
          id: field.id,
          title: field.name,
          placeholder: field.required ? "Required" : "Optional",
          value: String(values[field.id] ?? ""),
          error: errors[field.id],
          onChange: (value: string) => {
            setValues((current) => ({ ...current, [field.id]: value }));
            if (errors[field.id]) {
              setErrors((current) => {
                const remaining = { ...current };
                delete remaining[field.id];
                return remaining;
              });
            }
          },
        };
        return field.type === "text" && field.multiline ? (
          <Form.TextArea key={field.id} {...props} />
        ) : (
          <Form.TextField key={field.id} {...props} />
        );
      })}
    </Form>
  );
}
