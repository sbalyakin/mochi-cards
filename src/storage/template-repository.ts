import { randomUUID } from "node:crypto";

import { LocalStorage } from "@raycast/api";

import { normalizeDeckId, type CardTemplate, type CardTemplateDraft, type TemplateVariable } from "../domain/template";
import { assertValidTemplate, validateTemplate } from "../domain/template-validation";

const STORAGE_KEY = "mochi-card-templates";
const STORAGE_VERSION = 1;

type TemplateEnvelope = {
  readonly version: typeof STORAGE_VERSION;
  readonly templates: readonly CardTemplate[];
};

export interface TemplateStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export type TemplateRepositoryErrorKind = "corrupted-data" | "template-not-found";

export class TemplateRepositoryError extends Error {
  readonly kind: TemplateRepositoryErrorKind;

  constructor(kind: TemplateRepositoryErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateRepositoryError";
    this.kind = kind;
  }
}

export class TemplateRepository {
  private readonly storage: TemplateStorage;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(
    storage: TemplateStorage = raycastTemplateStorage,
    createId: () => string = randomUUID,
    now: () => Date = () => new Date()
  ) {
    this.storage = storage;
    this.createId = createId;
    this.now = now;
  }

  async list(): Promise<readonly CardTemplate[]> {
    const envelope = await this.readEnvelope();
    return [...envelope.templates].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: string): Promise<CardTemplate | undefined> {
    return (await this.readEnvelope()).templates.find((template) => template.id === id);
  }

  async create(draft: CardTemplateDraft): Promise<CardTemplate> {
    const normalizedDraft = normalizeDraft(draft);
    assertValidTemplate(normalizedDraft);

    const envelope = await this.readEnvelope();
    let id = this.createId();
    while (envelope.templates.some((template) => template.id === id)) {
      id = this.createId();
    }

    const template: CardTemplate = {
      ...normalizedDraft,
      id,
      updatedAt: this.now().toISOString(),
    };
    await this.writeTemplates([...envelope.templates, template]);
    return template;
  }

  async update(id: string, draft: CardTemplateDraft): Promise<CardTemplate> {
    const normalizedDraft = normalizeDraft(draft);
    assertValidTemplate(normalizedDraft);

    const envelope = await this.readEnvelope();
    if (!envelope.templates.some((template) => template.id === id)) {
      throw new TemplateRepositoryError("template-not-found", "The template no longer exists");
    }

    const template: CardTemplate = {
      ...normalizedDraft,
      id,
      updatedAt: this.now().toISOString(),
    };
    await this.writeTemplates(envelope.templates.map((existing) => (existing.id === id ? template : existing)));
    return template;
  }

  async duplicate(id: string): Promise<CardTemplate> {
    const envelope = await this.readEnvelope();
    const source = envelope.templates.find((template) => template.id === id);
    if (!source) {
      throw new TemplateRepositoryError("template-not-found", "The template no longer exists");
    }

    const names = new Set(envelope.templates.map((template) => template.name));
    const draft: CardTemplateDraft = {
      ...source,
      name: duplicateName(source.name, names),
    };
    return this.create(draft);
  }

  async delete(id: string): Promise<boolean> {
    const envelope = await this.readEnvelope();
    const templates = envelope.templates.filter((template) => template.id !== id);
    if (templates.length === envelope.templates.length) {
      return false;
    }

    await this.writeTemplates(templates);
    return true;
  }

  private async readEnvelope(): Promise<TemplateEnvelope> {
    const storedValue = await this.storage.getItem(STORAGE_KEY);
    if (storedValue === undefined) {
      return { version: STORAGE_VERSION, templates: [] };
    }

    try {
      const parsed: unknown = JSON.parse(storedValue);
      if (!isTemplateEnvelope(parsed)) {
        throw new Error("Stored template data does not match version 1");
      }
      return {
        ...parsed,
        templates: parsed.templates.map(normalizeStoredTemplate),
      };
    } catch (error: unknown) {
      throw new TemplateRepositoryError(
        "corrupted-data",
        "Saved templates are corrupted. The original data was left unchanged.",
        { cause: error }
      );
    }
  }

  private async writeTemplates(templates: readonly CardTemplate[]): Promise<void> {
    const envelope: TemplateEnvelope = { version: STORAGE_VERSION, templates };
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  }
}

const raycastTemplateStorage: TemplateStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return LocalStorage.getItem<string>(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await LocalStorage.setItem(key, value);
  },
};

function normalizeDraft(draft: CardTemplateDraft): CardTemplateDraft {
  return {
    name: draft.name.trim(),
    variables: draft.variables.map((variable) => ({
      name: variable.name.trim(),
      label: variable.label.trim(),
      required: variable.required,
    })),
    content: draft.content,
    deckId: normalizeDeckId(draft.deckId),
    tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))],
    reviewReverse: draft.reviewReverse,
    archived: draft.archived,
  };
}

function duplicateName(name: string, existingNames: ReadonlySet<string>): string {
  const base = `${name} Copy`;
  if (!existingNames.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingNames.has(`${base} ${suffix}`)) {
    suffix += 1;
  }
  return `${base} ${suffix}`;
}

function isTemplateEnvelope(value: unknown): value is TemplateEnvelope {
  if (!isRecord(value) || value.version !== STORAGE_VERSION || !Array.isArray(value.templates)) {
    return false;
  }
  return value.templates.every(isCardTemplate);
}

function isCardTemplate(value: unknown): value is CardTemplate {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.variables) ||
    !value.variables.every(isTemplateVariable) ||
    typeof value.content !== "string" ||
    typeof value.deckId !== "string" ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string") ||
    typeof value.reviewReverse !== "boolean" ||
    typeof value.archived !== "boolean" ||
    typeof value.updatedAt !== "string" ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    return false;
  }

  const template: CardTemplate = {
    id: value.id,
    name: value.name,
    variables: value.variables,
    content: value.content,
    deckId: normalizeDeckId(value.deckId),
    tags: value.tags,
    reviewReverse: value.reviewReverse,
    archived: value.archived,
    updatedAt: value.updatedAt,
  };
  return validateTemplate(template).length === 0;
}

function normalizeStoredTemplate(template: CardTemplate): CardTemplate {
  return { ...template, deckId: normalizeDeckId(template.deckId) };
}

function isTemplateVariable(value: unknown): value is TemplateVariable {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.label === "string" &&
    typeof value.required === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
