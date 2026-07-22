import type { CardTemplate, CardTemplateDraft } from "./template";
import { parseTemplate, TemplateParseError, type TemplateParseErrorCode } from "./template-parser";

export type TemplateValidationErrorCode =
  | "name-required"
  | "content-required"
  | "deck-id-required"
  | "variable-name-required"
  | "variable-name-invalid"
  | "variable-name-duplicate"
  | "variable-label-required"
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
    errors.push({ code: "deck-id-required", path: "deckId", message: "Mochi deck ID is required" });
  }

  const declaredNames = new Set<string>();
  template.variables.forEach((variable, index) => {
    const name = variable.name.trim();
    if (name.length === 0) {
      errors.push({
        code: "variable-name-required",
        path: `variables.${index}.name`,
        message: `Variable ${index + 1} needs a name`,
      });
    } else if (!VARIABLE_NAME_PATTERN.test(name)) {
      errors.push({
        code: "variable-name-invalid",
        path: `variables.${index}.name`,
        message: `Variable “${name}” must start with a letter and contain only letters, digits, and _`,
      });
    } else if (declaredNames.has(name)) {
      errors.push({
        code: "variable-name-duplicate",
        path: `variables.${index}.name`,
        message: `Variable “${name}” is declared more than once`,
      });
    } else {
      declaredNames.add(name);
    }

    if (variable.label.trim().length === 0) {
      errors.push({
        code: "variable-label-required",
        path: `variables.${index}.label`,
        message: `Variable ${index + 1} needs a label`,
      });
    }
  });

  for (const placeholder of template.content.matchAll(PLACEHOLDER_PATTERN)) {
    const name = placeholder[1];
    if (!declaredNames.has(name)) {
      errors.push({
        code: "unknown-placeholder",
        path: "content",
        message: `Unknown variable: <<${name}>>`,
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
