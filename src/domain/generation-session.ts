import type { CardTemplate, FieldValues } from "./template";
import type { AiClient, PreparedAiSegment, PreparedSegment } from "./template-engine";
import { prepareTemplate, trimOuterEmptyLines } from "./template-engine";

const MAX_AI_CONCURRENCY = 4;

export type GeneratedTextSegment = {
  readonly kind: "text";
  readonly content: string;
};

export type GeneratedAiSegment = {
  readonly kind: "ai";
  readonly id: string;
  readonly prompt: string;
  readonly result:
    | { readonly status: "generated"; readonly response: string }
    | { readonly status: "error"; readonly message: string; readonly previousResponse?: string };
};

export type GeneratedSegment = GeneratedTextSegment | GeneratedAiSegment;

export type GeneratedSession = {
  readonly mode: "generated";
  readonly segments: readonly GeneratedSegment[];
};

export type ManuallyEditedSession = {
  readonly mode: "manually-edited";
  readonly markdown: string;
  readonly generatedSnapshot: GeneratedSession;
};

export type GenerationSession = GeneratedSession | ManuallyEditedSession;

export type AiFieldError = {
  readonly id: string;
  readonly message: string;
};

export type GenerationProgress =
  | { readonly kind: "substituting-fields" }
  | { readonly kind: "generating-ai-fields"; readonly total: number }
  | { readonly kind: "ai-field-finished"; readonly number: number; readonly total: number; readonly succeeded: boolean }
  | { readonly kind: "rendering-preview" };

export async function generateSession(
  template: CardTemplate,
  values: FieldValues,
  aiClient: AiClient,
  signal?: AbortSignal,
  onProgress?: (progress: GenerationProgress) => void
): Promise<GeneratedSession> {
  onProgress?.({ kind: "substituting-fields" });
  const prepared = prepareTemplate(template, values);
  const aiSegments = prepared.filter((segment): segment is PreparedAiSegment => segment.kind === "ai");
  if (aiSegments.length > 0) {
    onProgress?.({ kind: "generating-ai-fields", total: aiSegments.length });
  }
  const results = await runAiRequests(aiSegments, aiClient, signal, (number, succeeded) =>
    onProgress?.({ kind: "ai-field-finished", number, total: aiSegments.length, succeeded })
  );

  throwIfAborted(signal);
  onProgress?.({ kind: "rendering-preview" });

  const resultsById = new Map(aiSegments.map((segment, index) => [segment.id, results[index]]));
  return {
    mode: "generated",
    segments: prepared.map((segment) => createGeneratedSegment(segment, resultsById)),
  };
}

export async function regenerateAll(
  session: GeneratedSession,
  aiClient: AiClient,
  signal?: AbortSignal
): Promise<GeneratedSession> {
  const aiSegments = getAiSegments(session);
  const results = await runAiRequests(aiSegments, aiClient, signal);

  throwIfAborted(signal);

  const resultsById = new Map(aiSegments.map((segment, index) => [segment.id, results[index]]));
  return {
    mode: "generated",
    segments: session.segments.map((segment) =>
      segment.kind === "text" ? segment : updateGeneratedSegment(segment, resultsById.get(segment.id), segment)
    ),
  };
}

export async function regenerateField(
  session: GeneratedSession,
  fieldId: string,
  aiClient: AiClient,
  signal?: AbortSignal
): Promise<GeneratedSession> {
  const field = getAiSegments(session).find((segment) => segment.id === fieldId);
  if (!field) {
    throw new Error(`AI field not found: ${fieldId}`);
  }

  const result = await runAiRequests([field], aiClient, signal);
  throwIfAborted(signal);

  return {
    mode: "generated",
    segments: session.segments.map((segment) =>
      segment.kind === "ai" && segment.id === fieldId ? updateGeneratedSegment(segment, result[0], segment) : segment
    ),
  };
}

export function editMarkdown(session: GeneratedSession, markdown: string): ManuallyEditedSession {
  return { mode: "manually-edited", markdown, generatedSnapshot: session };
}

export function restoreGenerated(session: ManuallyEditedSession): GeneratedSession {
  return session.generatedSnapshot;
}

export function renderMarkdown(session: GenerationSession): string {
  switch (session.mode) {
    case "manually-edited":
      return session.markdown;
    case "generated":
      return session.segments
        .map((segment) => {
          if (segment.kind === "text") {
            return segment.content;
          }
          return segment.result.status === "generated"
            ? segment.result.response
            : (segment.result.previousResponse ?? "");
        })
        .join("");
    default:
      return assertNever(session);
  }
}

export function getAiFieldErrors(session: GenerationSession): readonly AiFieldError[] {
  if (session.mode === "manually-edited") {
    return [];
  }

  return getAiSegments(session)
    .filter((segment) => segment.result.status === "error")
    .map((segment) => ({
      id: segment.id,
      message: segment.result.status === "error" ? segment.result.message : "",
    }));
}

export function isSessionReady(session: GenerationSession): boolean {
  return session.mode === "manually-edited" || getAiFieldErrors(session).length === 0;
}

export function getGeneratedAiFields(session: GeneratedSession): readonly GeneratedAiSegment[] {
  return getAiSegments(session);
}

function createGeneratedSegment(
  segment: PreparedSegment,
  resultsById: ReadonlyMap<string, PromiseSettledResult<string>>
): GeneratedSegment {
  if (segment.kind === "text") {
    return segment;
  }

  return updateGeneratedSegment(segment, resultsById.get(segment.id));
}

function updateGeneratedSegment(
  segment: PreparedAiSegment | GeneratedAiSegment,
  result: PromiseSettledResult<string> | undefined,
  previous?: GeneratedAiSegment
): GeneratedAiSegment {
  if (!result) {
    throw new Error(`Missing result for ${segment.id}`);
  }

  if (result.status === "fulfilled") {
    return {
      kind: "ai",
      id: segment.id,
      prompt: segment.prompt,
      result: { status: "generated", response: trimOuterEmptyLines(result.value) },
    };
  }

  const previousResponse = getPreviousResponse(previous);
  return {
    kind: "ai",
    id: segment.id,
    prompt: segment.prompt,
    result: {
      status: "error",
      message: errorMessage(result.reason),
      ...(previousResponse === undefined ? {} : { previousResponse }),
    },
  };
}

function getAiSegments(session: GeneratedSession): readonly GeneratedAiSegment[] {
  return session.segments.filter((segment): segment is GeneratedAiSegment => segment.kind === "ai");
}

async function runAiRequests(
  segments: readonly PreparedAiSegment[],
  aiClient: AiClient,
  signal: AbortSignal | undefined,
  onFieldFinished?: (number: number, succeeded: boolean) => void
): Promise<readonly PromiseSettledResult<string>[]> {
  const results = new Array<PromiseSettledResult<string>>(segments.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < segments.length) {
      const index = nextIndex;
      nextIndex += 1;
      const segment = segments[index];
      try {
        throwIfAborted(signal);
        results[index] = { status: "fulfilled", value: await aiClient.ask(segment.prompt, signal) };
      } catch (reason: unknown) {
        results[index] = { status: "rejected", reason };
      }
      onFieldFinished?.(index + 1, results[index].status === "fulfilled");
    }
  }

  const workerCount = Math.min(MAX_AI_CONCURRENCY, segments.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function getPreviousResponse(segment: GeneratedAiSegment | undefined): string | undefined {
  if (!segment) {
    return undefined;
  }
  return segment.result.status === "generated" ? segment.result.response : segment.result.previousResponse;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AI request failed";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Generation was cancelled");
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected generation session: ${JSON.stringify(value)}`);
}
