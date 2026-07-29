import { describe, expect, it } from "vitest";

import {
  aiThinkingLevels,
  anthropicThinkingConfig,
  anthropicMaxTokens,
  geminiMaxOutputTokens,
  openAiMaxOutputTokens,
  supportsAiThinking,
} from "./ai-thinking";

describe("AI thinking configuration", () => {
  it("uses adaptive thinking for Claude Sonnet and Opus 4.6 and later", () => {
    expect(anthropicThinkingConfig("claude-sonnet-4-6", "high")).toEqual({
      thinking: { type: "adaptive" },
      outputConfig: { effort: "high" },
    });
    expect(anthropicThinkingConfig("claude-opus-4-5", "high")).toEqual({
      thinking: { type: "enabled", budget_tokens: 8192 },
      budget: 8192,
    });
  });

  it("exposes thinking for Gemini Flash-Lite", () => {
    expect(supportsAiThinking("gemini", "gemini-2.5-flash-lite")).toBe(true);
    expect(supportsAiThinking("gemini", "gemini-2.5-flash")).toBe(true);
  });

  it("limits Gemini 3 Pro Preview to its supported thinking levels", () => {
    expect(aiThinkingLevels("gemini", "gemini-3-pro-preview")).toEqual(["low", "high"]);
  });

  it("uses a response-token reserve beyond a Gemini thinking budget", () => {
    expect(geminiMaxOutputTokens("gemini-2.5-flash", "medium")).toBe(5120);
    expect(geminiMaxOutputTokens("gemini-2.5-flash", "high")).toBe(9216);
  });

  it("does not assume every Claude model supports thinking", () => {
    expect(supportsAiThinking("anthropic", "claude-z")).toBe(false);
    expect(supportsAiThinking("anthropic", "claude-haiku-4-5")).toBe(true);
    expect(supportsAiThinking("anthropic", "claude-3-7-sonnet-20250219")).toBe(true);
  });

  it("limits OpenAI efforts to the selected model family", () => {
    expect(aiThinkingLevels("openai", "gpt-5.6-sol")).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(aiThinkingLevels("openai", "gpt-5.4")).toEqual(["none", "low", "medium", "high", "xhigh"]);
    expect(aiThinkingLevels("openai", "gpt-5.4-pro")).toEqual(["medium", "high", "xhigh"]);
    expect(aiThinkingLevels("openai", "gpt-5.5")).toEqual(["none", "low", "medium", "high", "xhigh"]);
    expect(aiThinkingLevels("openai", "gpt-5-pro")).toEqual(["high"]);
    expect(aiThinkingLevels("openai", "o1")).toEqual(["medium", "high"]);
  });

  it("reserves more output tokens for higher OpenAI reasoning efforts", () => {
    expect(openAiMaxOutputTokens(undefined)).toBe(4096);
    expect(openAiMaxOutputTokens("medium")).toBe(8192);
    expect(openAiMaxOutputTokens("max")).toBe(32768);
  });

  it("reserves more output tokens for higher Claude thinking efforts", () => {
    expect(anthropicMaxTokens(undefined)).toBe(4096);
    expect(anthropicMaxTokens("medium")).toBe(8192);
    expect(anthropicMaxTokens("high")).toBe(32768);
  });
});
