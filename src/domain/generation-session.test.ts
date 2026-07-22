import { describe, expect, it } from "vitest";

import {
  editMarkdown,
  generateSession,
  getAiFieldErrors,
  isSessionReady,
  regenerateAll,
  regenerateField,
  renderMarkdown,
  restoreGenerated,
} from "./generation-session";
import type { CardTemplate } from "./template";
import { trimOuterEmptyLines, type AiClient } from "./template-engine";

describe("generation session", () => {
  it("substitutes repeated and empty fields before independent AI calls", async () => {
    const prompts: string[] = [];
    const client: AiClient = {
      async ask(prompt: string): Promise<string> {
        prompts.push(prompt);
        return prompt.includes("first") ? "\n\nONE\n\n" : "TWO";
      },
    };

    const session = await generateSession(
      template("# <<word>> / <<word>> / <<context>>\n<ai>first <<word>></ai>\n<ai>second <<context>></ai>"),
      { word: "λόγος", context: "" },
      client
    );

    expect(prompts).toEqual(["first λόγος", "second "]);
    expect(renderMarkdown(session)).toBe("# λόγος / λόγος / \nONE\nTWO");
  });

  it("keeps successful fields when another AI request fails", async () => {
    const client: AiClient = {
      async ask(prompt: string): Promise<string> {
        if (prompt === "bad") {
          throw new Error("Model unavailable");
        }
        return "good response";
      },
    };

    const session = await generateSession(template("<ai>good</ai>|<ai>bad</ai>"), {}, client);
    expect(renderMarkdown(session)).toBe("good response|");
    expect(getAiFieldErrors(session)).toEqual([{ id: "ai-field-2", message: "Model unavailable" }]);
    expect(isSessionReady(session)).toBe(false);
  });

  it("regenerates one field without changing the others", async () => {
    let responseNumber = 0;
    const client: AiClient = {
      async ask(): Promise<string> {
        responseNumber += 1;
        return `response-${responseNumber}`;
      },
    };
    const initial = await generateSession(template("<ai>one</ai>|<ai>two</ai>"), {}, client);
    const regenerated = await regenerateField(initial, "ai-field-2", client);

    expect(renderMarkdown(initial)).toBe("response-1|response-2");
    expect(renderMarkdown(regenerated)).toBe("response-1|response-3");
  });

  it("keeps previous responses when a full regeneration partially fails", async () => {
    const initial = await generateSession(
      template("<ai>one</ai>|<ai>two</ai>"),
      {},
      {
        ask: async (prompt) => `initial-${prompt}`,
      }
    );
    const regenerated = await regenerateAll(initial, {
      ask: async (prompt) => {
        if (prompt === "two") {
          throw new Error("retry failed");
        }
        return `updated-${prompt}`;
      },
    });

    expect(renderMarkdown(regenerated)).toBe("updated-one|initial-two");
    expect(getAiFieldErrors(regenerated)).toEqual([{ id: "ai-field-2", message: "retry failed" }]);
  });

  it("bounds concurrent AI requests", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const content = Array.from({ length: 7 }, (_, index) => `<ai>field-${index}</ai>`).join("|");

    await generateSession(
      template(content),
      {},
      {
        async ask(prompt): Promise<string> {
          activeRequests += 1;
          maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeRequests -= 1;
          return prompt;
        },
      }
    );

    expect(maximumActiveRequests).toBe(4);
  });

  it("does not parse placeholders or AI tags returned by AI", async () => {
    const client: AiClient = {
      async ask(): Promise<string> {
        return "\n<<word>>\n<ai>literal</ai>\n";
      },
    };
    const session = await generateSession(template("<ai>prompt</ai>"), { word: "changed" }, client);
    expect(renderMarkdown(session)).toBe("<<word>>\n<ai>literal</ai>");
  });

  it("trims only outer empty lines from AI responses", () => {
    expect(trimOuterEmptyLines("\r\n  \r\n  first  \r\nsecond\r\n\t")).toBe("  first  \r\nsecond");
  });

  it("preserves a generated snapshot through manual editing", async () => {
    const generated = await generateSession(template("Plain text"), {}, { ask: async () => "unused" });
    const edited = editMarkdown(generated, "Manual text");

    expect(renderMarkdown(edited)).toBe("Manual text");
    expect(renderMarkdown(restoreGenerated(edited))).toBe("Plain text");
  });
});

function template(content: string): CardTemplate {
  return {
    id: "template-1",
    name: "Test",
    fields: [
      { name: "word", required: false },
      { name: "context", required: false },
    ],
    content,
    deckId: "deck-1",
    deckName: "Vocabulary",
    tags: [],
    reviewReverse: false,
    archived: false,
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
