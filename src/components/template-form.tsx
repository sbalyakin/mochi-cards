import { randomUUID } from "node:crypto";

import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useRef, useState } from "react";

import type { CardTemplate, CardTemplateDraft, TemplateVariable } from "../domain/template";
import { validateTemplate, type TemplateValidationError } from "../domain/template-validation";
import type { TemplateRepository } from "../storage/template-repository";

type EditableVariable = TemplateVariable & {
  readonly key: string;
};

type TemplateFormProps = {
  readonly repository: TemplateRepository;
  readonly template?: CardTemplate;
  readonly onSaved: () => Promise<void> | void;
};

export function TemplateForm({ repository, template, onSaved }: TemplateFormProps) {
  const { pop } = useNavigation();
  const [name, setName] = useState(template?.name ?? "");
  const [deckId, setDeckId] = useState(template?.deckId ?? "");
  const [tags, setTags] = useState(template?.tags.join(", ") ?? "");
  const [content, setContent] = useState(template?.content ?? "");
  const [reviewReverse, setReviewReverse] = useState(template?.reviewReverse ?? false);
  const [archived, setArchived] = useState(template?.archived ?? false);
  const [variables, setVariables] = useState<readonly EditableVariable[]>(
    template?.variables.map(toEditableVariable) ?? [createEmptyVariable()]
  );
  const [showValidation, setShowValidation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);

  const draft = createDraft({ name, deckId, tags, content, reviewReverse, archived, variables });
  const validationErrors = showValidation ? validateTemplate(draft) : [];

  async function save(): Promise<void> {
    if (saving.current) {
      return;
    }
    setShowValidation(true);
    const errors = validateTemplate(draft);
    if (errors.length > 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Fix the template before saving",
        message: errors[0].message,
      });
      return;
    }

    saving.current = true;
    setIsSaving(true);
    try {
      if (template) {
        await repository.update(template.id, draft);
      } else {
        await repository.create(draft);
      }
      await onSaved();
      await showToast({ style: Toast.Style.Success, title: template ? "Template updated" : "Template created" });
      pop();
    } catch (error: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "Could not save template", message: errorMessage(error) });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  function updateVariable(key: string, update: Partial<TemplateVariable>): void {
    setVariables((current) =>
      current.map((variable) => (variable.key === key ? { ...variable, ...update } : variable))
    );
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle={template ? `Edit ${template.name}` : "Create Template"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={template ? "Save Changes" : "Create Template"}
            icon={Icon.SaveDocument}
            onSubmit={save}
          />
          <Action
            title="Add Variable"
            icon={Icon.Plus}
            onAction={() => setVariables((current) => [...current, createEmptyVariable()])}
          />
          {variables.length > 0 ? (
            <ActionPanel.Submenu title="Remove Variable" icon={Icon.MinusCircle}>
              {variables.map((variable, index) => (
                <Action
                  key={variable.key}
                  title={variable.label || variable.name || `Variable ${index + 1}`}
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => setVariables((current) => current.filter((item) => item.key !== variable.key))}
                />
              ))}
            </ActionPanel.Submenu>
          ) : null}
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Template Name"
        placeholder="Greek vocabulary"
        value={name}
        error={fieldError(validationErrors, "name")}
        onChange={setName}
      />
      <Form.TextField
        id="deckId"
        title="Mochi Deck ID"
        placeholder="Paste the deck ID from Mochi"
        value={deckId}
        error={fieldError(validationErrors, "deckId")}
        onChange={setDeckId}
      />
      <Form.TextField
        id="tags"
        title="Tags"
        placeholder="greek, vocabulary"
        info="Comma-separated Mochi manual tags"
        value={tags}
        onChange={setTags}
      />
      <Form.Checkbox
        id="reviewReverse"
        title="Review"
        label="Enable reverse review"
        value={reviewReverse}
        onChange={setReviewReverse}
      />
      <Form.Checkbox
        id="archived"
        title="Status"
        label="Create cards as archived"
        value={archived}
        onChange={setArchived}
      />
      <Form.Separator />
      <Form.TextArea
        id="content"
        title="Markdown Template"
        placeholder={"# <<word>>\n\n<ai>\nTranslate <<word>>.\n</ai>"}
        info="Use <<variable>> placeholders and <ai>...</ai> fields"
        value={content}
        error={fieldError(validationErrors, "content")}
        onChange={setContent}
      />
      <Form.Separator />
      <Form.Description
        title="Variables"
        text="Add one row for every placeholder. Required variables must be filled before generation."
      />
      {variables.map((variable, index) => (
        <VariableFields
          key={variable.key}
          index={index}
          variable={variable}
          errors={validationErrors}
          onChange={(update) => updateVariable(variable.key, update)}
        />
      ))}
      {validationErrors.length > 0 ? (
        <Form.Description
          title="Validation"
          text={`${validationErrors.length} issue(s) must be fixed before saving.`}
        />
      ) : null}
    </Form>
  );
}

type VariableFieldsProps = {
  readonly index: number;
  readonly variable: EditableVariable;
  readonly errors: readonly TemplateValidationError[];
  readonly onChange: (update: Partial<TemplateVariable>) => void;
};

function VariableFields({ index, variable, errors, onChange }: VariableFieldsProps) {
  return (
    <>
      {index > 0 ? <Form.Separator /> : null}
      <Form.TextField
        id={`variable-${variable.key}-name`}
        title={`Variable ${index + 1} Name`}
        placeholder="word"
        value={variable.name}
        error={fieldError(errors, `variables.${index}.name`)}
        onChange={(name) => onChange({ name })}
      />
      <Form.TextField
        id={`variable-${variable.key}-label`}
        title={`Variable ${index + 1} Label`}
        placeholder="Word"
        value={variable.label}
        error={fieldError(errors, `variables.${index}.label`)}
        onChange={(label) => onChange({ label })}
      />
      <Form.Checkbox
        id={`variable-${variable.key}-required`}
        title={`Variable ${index + 1}`}
        label="Required"
        value={variable.required}
        onChange={(required) => onChange({ required })}
      />
    </>
  );
}

function createEmptyVariable(): EditableVariable {
  return { key: randomUUID(), name: "", label: "", required: false };
}

function toEditableVariable(variable: TemplateVariable): EditableVariable {
  return { ...variable, key: randomUUID() };
}

function createDraft(values: {
  readonly name: string;
  readonly deckId: string;
  readonly tags: string;
  readonly content: string;
  readonly reviewReverse: boolean;
  readonly archived: boolean;
  readonly variables: readonly EditableVariable[];
}): CardTemplateDraft {
  return {
    name: values.name,
    deckId: values.deckId,
    tags: values.tags.split(","),
    content: values.content,
    reviewReverse: values.reviewReverse,
    archived: values.archived,
    variables: values.variables.map(({ name, label, required }) => ({ name, label, required })),
  };
}

function fieldError(errors: readonly TemplateValidationError[], path: string): string | undefined {
  const messages = errors.filter((error) => error.path === path).map((error) => error.message);
  return messages.length > 0 ? messages.join(" · ") : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
