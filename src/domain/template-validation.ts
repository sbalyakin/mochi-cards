import type { CardTemplate, CardTemplateDraft } from "./template";
import { parseTemplate, TemplateParseError, type TemplateParseErrorCode } from "./template-parser";

export type TemplateValidationErrorCode =
  | "name-required"
  | "content-required"
  | "deck-id-required"
  | "deck-name-required"
  | "field-name-required"
  | "field-name-invalid"
  | "field-name-duplicate"
  | "unknown-placeholder"
  | TemplateParseErrorCode;

export type TemplateValidationError = {
  readonly code: TemplateValidationErrorCode;
  readonly path: string;
  readonly message: string;
};

export class InvalidTemplateError extends Error {
  readonly errors: readonly TemplateValidationError[];

  constructor(errors: readonly TemplateValidationError[]) {
    super(errors.map((error) => error.message).join("; "));
    this.name = "InvalidTemplateError";
    this.errors = errors;
  }
}

const VARIABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const PLACEHOLDER_PATTERN = /<<([^<>]+)>>/g;

export function validateTemplate(template: CardTemplate | CardTemplateDraft): readonly TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];

  if (template.name.trim().length === 0) {
    errors.push({ code: "name-required", path: "name", message: "Template name is required" });
  }
  if (template.content.trim().length === 0) {
    errors.push({ code: "content-required", path: "content", message: "Markdown content is required" });
  }
  if (template.deckId.trim().length === 0) {
    errors.push({ code: "deck-id-required", path: "deckId", message: "Select a Mochi deck" });
  }
  if (template.deckName.trim().length === 0) {
    errors.push({ code: "deck-name-required", path: "deckId", message: "Select a Mochi deck" });
  }

  const declaredNames = new Set<string>();
  template.fields.forEach((field, index) => {
    const name = field.name.trim();
    if (name.length === 0) {
      errors.push({
        code: "field-name-required",
        path: `fields.${index}.name`,
        message: `Field ${index + 1} needs a name`,
      });
    } else if (!VARIABLE_NAME_PATTERN.test(name)) {
      errors.push({
        code: "field-name-invalid",
        path: `fields.${index}.name`,
        message: `Field “${name}” must start with a letter and contain only letters, digits, and _`,
      });
    } else if (declaredNames.has(name)) {
      errors.push({
        code: "field-name-duplicate",
        path: `fields.${index}.name`,
        message: `Field “${name}” is declared more than once`,
      });
    } else {
      declaredNames.add(name);
    }
  });

  for (const placeholder of template.content.matchAll(PLACEHOLDER_PATTERN)) {
    const name = placeholder[1].trim();
    if (!declaredNames.has(name)) {
      errors.push({
        code: "unknown-placeholder",
        path: "content",
        message: `Unknown field: <<${name}>>`,
      });
    }
  }

  try {
    parseTemplate(template.content);
  } catch (error: unknown) {
    if (error instanceof TemplateParseError) {
      errors.push({ code: error.code, path: "content", message: error.message });
    } else {
      throw error;
    }
  }

  return errors;
}

export function assertValidTemplate(template: CardTemplate | CardTemplateDraft): void {
  const errors = validateTemplate(template);
  if (errors.length > 0) {
    throw new InvalidTemplateError(errors);
  }
}
