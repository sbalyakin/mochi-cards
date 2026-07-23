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
    Object.fromEntries(template.fields.map((field) => [field.name, ""]))
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  function resetInput(): void {
    setValues(Object.fromEntries(template.fields.map((field) => [field.name, ""])));
    setErrors({});
  }

  async function generate(): Promise<void> {
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
