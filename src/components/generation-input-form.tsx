import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useState, type ReactNode } from "react";

import type { CardTemplate, FieldValues } from "../domain/template";
import { CardPreview } from "./card-preview";

type GenerationInputFormProps = {
  readonly template: CardTemplate;
  readonly initialValues?: FieldValues;
  readonly mode?: "create" | "update";
  readonly onGenerate?: (values: FieldValues) => Promise<void> | void;
  readonly onValuesChange?: (values: FieldValues) => void;
  readonly secondaryActions?: ReactNode;
  readonly warnings?: readonly string[];
};

export function GenerationInputForm({
  template,
  initialValues,
  mode = "create",
  onGenerate,
  onValuesChange,
  secondaryActions,
  warnings = [],
}: GenerationInputFormProps) {
  const { push } = useNavigation();
  const emptyValues = (): FieldValues =>
    Object.fromEntries(
      template.fields.map((field) => [field.id, initialValues?.[field.id] ?? (field.type === "boolean" ? false : "")])
    );
  const [values, setValues] = useState<FieldValues>(emptyValues);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  function resetInput(): void {
    setValues(emptyValues());
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

    if (onGenerate) {
      await onGenerate(values);
    } else {
      push(<CardPreview template={template} values={values} mode={{ kind: "create", onCardAdded: resetInput }} />);
    }
  }

  return (
    <Form
      navigationTitle={mode === "update" ? `Edit ${template.name}` : template.name}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Generate Preview" icon={Icon.Stars} onSubmit={generate} />
          {secondaryActions}
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
      {warnings.map((warning, index) => (
        <Form.Description key={`${warning}-${index}`} title="Warning" text={warning} />
      ))}
      {template.fields.map((field) => {
        if (field.type === "boolean") {
          return (
            <Form.Checkbox
              key={field.id}
              id={field.id}
              title={field.name}
              label="Enabled"
              value={values[field.id] === true}
              onChange={(value) => {
                const next = { ...values, [field.id]: value };
                setValues(next);
                onValuesChange?.(next);
              }}
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
            const next = { ...values, [field.id]: value };
            setValues(next);
            onValuesChange?.(next);
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
