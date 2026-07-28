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
});
