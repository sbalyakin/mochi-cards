import type { AiProvider } from "./ai-provider";

export const AI_THINKING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const GPT_5_6_THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
const GPT_5_4_AND_5_5_THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh"] as const;

export type AiThinkingLevel = (typeof AI_THINKING_LEVELS)[number];

export function aiThinkingLevels(
  provider: Exclude<AiProvider, "raycast">,
  model: string | undefined
): readonly AiThinkingLevel[] {
  switch (provider) {
    case "openai":
      return openAiThinkingLevels(model);
    case "gemini":
      return geminiThinkingLevels(model);
    case "anthropic":
      return ["low", "medium", "high"];
  }
}

export function supportsAiThinking(provider: Exclude<AiProvider, "raycast">, model: string | undefined): boolean {
  if (!model) {
    return false;
  }
  switch (provider) {
    case "openai":
      return /^(gpt-5|o[134](?:-|$))/.test(model);
    case "gemini":
      return /^gemini-(?:3(?:\.|-)|2\.5-(?:flash|pro)(?:-|$)|(?:flash|flash-lite|pro)-latest)/.test(model);
    case "anthropic":
      return /^(?:claude-(?:opus|sonnet|haiku|fable|mythos)-(?:3-7|4|5)|claude-3-7-sonnet)(?:-|$)/.test(model);
  }
}

export function geminiThinkingConfig(
  model: string,
  level: AiThinkingLevel | undefined
): Record<string, unknown> | undefined {
  if (!level || level === "none") {
    return undefined;
  }
  if (/^gemini-3(?:\.|-)/.test(model)) {
    return { thinkingLevel: level };
  }
  const thinkingBudget = thinkingBudgetFor(level);
  if (thinkingBudget === undefined) {
    return undefined;
  }
  return { thinkingBudget };
}

export function geminiMaxOutputTokens(model: string, level: AiThinkingLevel | undefined): number {
  const budget = /^gemini-3(?:\.|-)/.test(model) ? undefined : thinkingBudgetFor(level ?? "none");
  return Math.max(4096, (budget ?? 0) + 1024);
}

export function anthropicThinkingBudget(level: AiThinkingLevel | undefined): number | undefined {
  if (!level || level === "none") {
    return undefined;
  }
  return thinkingBudgetFor(level);
}

export function anthropicThinkingConfig(
  model: string,
  level: AiThinkingLevel | undefined
): {
  readonly thinking?: Record<string, unknown>;
  readonly outputConfig?: Record<string, unknown>;
  readonly budget?: number;
} {
  if (!level || level === "none") {
    return {};
  }
  if (claudeUsesAdaptiveThinking(model)) {
    return { thinking: { type: "adaptive" }, outputConfig: { effort: level } };
  }
  const budget = anthropicThinkingBudget(level);
  return budget ? { thinking: { type: "enabled", budget_tokens: budget }, budget } : {};
}

function openAiThinkingLevels(model: string | undefined): readonly AiThinkingLevel[] {
  if (!model) {
    return [];
  }
  if (/^gpt-5\.6(?:-|$)/.test(model)) {
    return GPT_5_6_THINKING_LEVELS;
  }
  if (/^gpt-5\.5-pro(?:-|$)/.test(model)) {
    return ["medium", "high", "xhigh"];
  }
  if (/^gpt-5\.4-pro(?:-|$)/.test(model)) {
    return ["medium", "high", "xhigh"];
  }
  if (/^gpt-5\.[45](?:-|$)/.test(model)) {
    return GPT_5_4_AND_5_5_THINKING_LEVELS;
  }
  if (/^gpt-5-pro(?:-|$)/.test(model)) {
    return ["high"];
  }
  if (/^gpt-5(?:[.-]|$)/.test(model)) {
    return ["minimal", "low", "medium", "high"];
  }
  if (/^o1(?:-|$)/.test(model)) {
    return ["medium", "high"];
  }
  return ["low", "medium", "high"];
}

function geminiThinkingLevels(model: string | undefined): readonly AiThinkingLevel[] {
  return /^gemini-3-pro(?:-|$)/.test(model ?? "") ? ["low", "high"] : ["low", "medium", "high"];
}

export function openAiMaxOutputTokens(level: AiThinkingLevel | undefined): number {
  switch (level) {
    case "high":
    case "xhigh":
    case "max":
      return 32768;
    case "low":
    case "medium":
    case "minimal":
      return 8192;
    case "none":
    case undefined:
      return 4096;
  }
}

export function anthropicMaxTokens(level: AiThinkingLevel | undefined): number {
  switch (level) {
    case "high":
      return 32768;
    case "low":
    case "medium":
      return 8192;
    case "none":
    case "minimal":
    case "xhigh":
    case "max":
    case undefined:
      return 4096;
  }
}

function claudeUsesAdaptiveThinking(model: string): boolean {
  const match = /^claude-(opus|sonnet|fable|mythos)-(\d+)(?:-(\d+))?/.exec(model);
  if (!match) {
    return false;
  }
  const family = match[1];
  const major = Number(match[2]);
  const minor = Number(match[3] ?? 0);
  return major > 4 || (major === 4 && minor >= 6 && (family === "opus" || family === "sonnet"));
}

function thinkingBudgetFor(level: AiThinkingLevel): number | undefined {
  switch (level) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    case "none":
    case "minimal":
    case "xhigh":
    case "max":
      return undefined;
  }
}
