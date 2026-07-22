import { randomUUID } from "node:crypto";

import {
  Action,
  ActionPanel,
  Form,
  getPreferenceValues,
  Icon,
  Keyboard,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef, useState } from "react";

import type { CardTemplate, CardTemplateDraft, TemplateField } from "../domain/template";
import { validateTemplate, type TemplateValidationError } from "../domain/template-validation";
import { MochiClient } from "../services/mochi-client";
import type { TemplateRepository } from "../storage/template-repository";

type EditableField = TemplateField & {
  readonly key: string;
};

type TemplateFormProps = {
  readonly repository: TemplateRepository;
  readonly template?: CardTemplate;
  readonly onSaved: () => Promise<void> | void;
};

type Preferences = {
  readonly mochiApiKey: string;
};

export function TemplateForm({ repository, template, onSaved }: TemplateFormProps) {
  const { pop } = useNavigation();
  const { mochiApiKey } = getPreferenceValues<Preferences>();
  const [name, setName] = useState(template?.name ?? "");
  const [deckId, setDeckId] = useState(template?.deckId ?? "");
  const [tags, setTags] = useState(template?.tags.join(", ") ?? "");
  const [content, setContent] = useState(template?.content ?? "");
  const [reviewReverse, setReviewReverse] = useState(template?.reviewReverse ?? false);
  const [archived, setArchived] = useState(template?.archived ?? false);
  const [fields, setFields] = useState<readonly EditableField[]>(
    template?.fields.map(toEditableField) ?? [createInitialField()]
  );
  const [showValidation, setShowValidation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const {
    data: decks = [],
    error: decksError,
    isLoading: isLoadingDecks,
  } = usePromise(() => new MochiClient(mochiApiKey).listDecks(), []);

  const selectedDeck = decks.find((deck) => deck.id === deckId);
  const draft = createDraft({
    name,
    deckId,
    deckName: selectedDeck?.name ?? template?.deckName ?? "",
    tags,
    content,
    reviewReverse,
    archived,
    fields,
  });
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

  function updateField(key: string, update: Partial<TemplateField>): void {
    setFields((current) => current.map((field) => (field.key === key ? { ...field, ...update } : field)));
  }

  function addField(): void {
    setFields((current) => [...current, createEmptyField()]);
  }

  function removeField(key: string): void {
    setFields((current) => (current.length > 1 ? current.filter((field) => field.key !== key) : current));
  }

  function moveField(key: string, direction: -1 | 1): void {
    setFields((current) => {
      const index = current.findIndex((field) => field.key === key);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) {
        return current;
      }

      const reordered = [...current];
      const [field] = reordered.splice(index, 1);
      reordered.splice(destination, 0, field);
      return reordered;
    });
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
          <Action title="New Field" icon={Icon.Plus} shortcut={Keyboard.Shortcut.Common.New} onAction={addField} />
          {fields.length > 1 ? (
            <ActionPanel.Submenu title="Reorder Fields" icon={Icon.ArrowUp} shortcut={{ modifiers: ["cmd"], key: "m" }}>
              {fields.map((field, index) => (
                <ActionPanel.Section key={field.key} title={field.name || `Field ${index + 1}`}>
                  {index > 0 ? (
                    <Action title="Move up" icon={Icon.ArrowUp} onAction={() => moveField(field.key, -1)} />
                  ) : null}
                  {index < fields.length - 1 ? (
                    <Action title="Move Down" icon={Icon.ArrowDown} onAction={() => moveField(field.key, 1)} />
                  ) : null}
                </ActionPanel.Section>
              ))}
            </ActionPanel.Submenu>
          ) : null}
          {fields.length > 1 ? (
            <ActionPanel.Submenu
              title="Remove Field"
              icon={Icon.MinusCircle}
              shortcut={Keyboard.Shortcut.Common.Refresh}
            >
              {fields.map((field, index) => (
                <ActionPanel.Section key={field.key} title={field.name || `Field ${index + 1}`}>
                  <Action
                    title="Remove Field"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => removeField(field.key)}
                  />
                </ActionPanel.Section>
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
      <Form.Dropdown
        id="deckId"
        title="Mochi Deck"
        placeholder="Choose a deck"
        value={deckId}
        error={fieldError(validationErrors, "deckId")}
        onChange={setDeckId}
      >
        {deckId.length > 0 && !selectedDeck ? (
          <Form.Dropdown.Item title={template?.deckName || "Unavailable deck"} value={deckId} />
        ) : null}
        {decks.map((deck) => (
          <Form.Dropdown.Item key={deck.id} title={deck.name} value={deck.id} />
        ))}
      </Form.Dropdown>
      {isLoadingDecks ? <Form.Description title="Mochi Deck" text="Loading decks…" /> : null}
      {decksError ? <Form.Description title="Mochi Deck" text={errorMessage(decksError)} /> : null}
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
        info="Use <<field>> placeholders and <ai>...</ai> fields"
        value={content}
        error={fieldError(validationErrors, "content")}
        onChange={setContent}
      />
      <Form.Separator />
      <Form.Description title="Fields" text="Add, remove, or reorder fields from the Actions menu." />
      {fields.map((field, index) => (
        <FieldFields
          key={field.key}
          index={index}
          field={field}
          errors={validationErrors}
          onChange={(update) => updateField(field.key, update)}
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

type FieldFieldsProps = {
  readonly index: number;
  readonly field: EditableField;
  readonly errors: readonly TemplateValidationError[];
  readonly onChange: (update: Partial<TemplateField>) => void;
};

function FieldFields({ index, field, errors, onChange }: FieldFieldsProps) {
  return (
    <>
      {index > 0 ? <Form.Separator /> : null}
      <Form.TextField
        id={`field-${field.key}-name`}
        title={`Field ${index + 1}`}
        placeholder="word"
        value={field.name}
        error={fieldError(errors, `fields.${index}.name`)}
        onChange={(name) => onChange({ name })}
      />
      <Form.Checkbox
        id={`field-${field.key}-required`}
        label="Required"
        value={field.required}
        onChange={(required) => onChange({ required })}
      />
    </>
  );
}

function createEmptyField(): EditableField {
  return { key: randomUUID(), name: "", required: false };
}

function createInitialField(): EditableField {
  return { key: randomUUID(), name: "Name", required: true };
}

function toEditableField(field: TemplateField): EditableField {
  return { ...field, key: randomUUID() };
}

function createDraft(values: {
  readonly name: string;
  readonly deckId: string;
  readonly deckName: string;
  readonly tags: string;
  readonly content: string;
  readonly reviewReverse: boolean;
  readonly archived: boolean;
  readonly fields: readonly EditableField[];
}): CardTemplateDraft {
  return {
    name: values.name,
    deckId: values.deckId,
    deckName: values.deckName,
    tags: values.tags.split(","),
    content: values.content,
    reviewReverse: values.reviewReverse,
    archived: values.archived,
    fields: values.fields.map(({ name, required }) => ({ name, required })),
  };
}

function fieldError(errors: readonly TemplateValidationError[], path: string): string | undefined {
  const messages = errors.filter((error) => error.path === path).map((error) => error.message);
  return messages.length > 0 ? messages.join(" · ") : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
