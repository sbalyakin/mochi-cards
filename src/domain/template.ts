export type TemplateVariable = {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
};

export type CardTemplate = {
  readonly id: string;
  readonly name: string;
  readonly variables: readonly TemplateVariable[];
  readonly content: string;
  readonly deckId: string;
  readonly tags: readonly string[];
  readonly reviewReverse: boolean;
  readonly archived: boolean;
  readonly updatedAt: string;
};

export type CardTemplateDraft = Omit<CardTemplate, "id" | "updatedAt">;

export type VariableValues = Readonly<Record<string, string>>;

export function normalizeDeckId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
    return trimmed.slice(2, -2).trim();
  }
  return trimmed;
}
