import type { CardTemplate, VariableValues } from "./template";
import { parseTemplate } from "./template-parser";
import { assertValidTemplate } from "./template-validation";

export interface AiClient {
  ask(prompt: string, signal?: AbortSignal): Promise<string>;
}

export type PreparedTextSegment = {
  readonly kind: "text";
  readonly content: string;
};

export type PreparedAiSegment = {
  readonly kind: "ai";
  readonly id: string;
  readonly prompt: string;
};

export type PreparedSegment = PreparedTextSegment | PreparedAiSegment;

const PLACEHOLDER_PATTERN = /<<([^<>]+)>>/g;

export function prepareTemplate(template: CardTemplate, values: VariableValues): readonly PreparedSegment[] {
  assertValidTemplate(template);

  return parseTemplate(template.content).map((segment) => {
    switch (segment.kind) {
      case "text":
        return { kind: "text", content: substituteVariables(segment.content, values) };
      case "ai":
        return { kind: "ai", id: segment.id, prompt: substituteVariables(segment.prompt, values) };
      default:
        return assertNever(segment);
    }
  });
}

export function substituteVariables(content: string, values: VariableValues): string {
  return content.replace(PLACEHOLDER_PATTERN, (_placeholder, name: string) => values[name] ?? "");
}

export function trimOuterEmptyLines(content: string): string {
  return content.replace(/^(?:[ \t]*(?:\r\n|\n|\r))+/, "").replace(/(?:(?:\r\n|\n|\r)[ \t]*)+$/, "");
}

function assertNever(value: never): never {
  throw new Error(`Unexpected template segment: ${JSON.stringify(value)}`);
}
