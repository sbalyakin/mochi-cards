import { describe, expect, it } from "vitest";

import { displayAiModelName, humanizeAiModelId } from "./ai-model-display-name";

describe("AI model display names", () => {
  it.each([
    ["gpt-5.6-sol", "GPT-5.6 Sol"],
    ["gemini-2.5-flash", "Gemini 2.5 Flash"],
    ["claude-opus-5", "Claude Opus 5"],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
  ])("humanizes %s", (modelId, expected) => {
    expect(humanizeAiModelId(modelId)).toBe(expected);
  });

  it("uses Raycast AI when selected", () => {
    expect(displayAiModelName({ aiProvider: "raycast" })).toBe("Raycast AI");
  });

  it("uses the selected external model", () => {
    expect(displayAiModelName({ aiProvider: "openai", openaiModel: "gpt-5.6-sol" })).toBe("GPT-5.6 Sol");
  });

  it("prefers the stored provider model name", () => {
    expect(
      displayAiModelName({
        aiProvider: "anthropic",
        anthropicModel: "claude-haiku-4-5-20251001",
        anthropicModelName: "Claude Haiku 4.5",
      })
    ).toBe("Claude Haiku 4.5");
  });

  it("shows the custom model when set", () => {
    expect(displayAiModelName({ aiProvider: "custom", customProviderName: "Ollama", customModel: "llama3.1" })).toBe(
      "Llama3.1"
    );
  });

  it("falls back to the custom provider name without a model", () => {
    expect(displayAiModelName({ aiProvider: "custom", customProviderName: "Ollama" })).toBe("Ollama");
  });

  it("falls back to Custom AI without a provider name or model", () => {
    expect(displayAiModelName({ aiProvider: "custom" })).toBe("Custom AI");
  });
});
