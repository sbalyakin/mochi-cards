import { describe, expect, it, vi } from "vitest";

import { RaycastAiClient } from "./raycast-ai-client";

vi.mock("@raycast/api", () => ({
  AI: { ask: vi.fn() },
  environment: { canAccess: vi.fn() },
}));

describe("RaycastAiClient", () => {
  it("sends the prompt and abort signal to Raycast AI", async () => {
    const request = vi.fn(async () => "answer");
    const controller = new AbortController();

    await expect(new RaycastAiClient(request, () => true).ask("prompt", controller.signal)).resolves.toBe("answer");

    expect(request).toHaveBeenCalledWith("prompt", { signal: controller.signal });
  });

  it("rejects when Raycast AI is unavailable", async () => {
    await expect(new RaycastAiClient(vi.fn(), () => false).ask("prompt")).rejects.toMatchObject({
      provider: "raycast",
      kind: "authentication",
      message: "Raycast AI access is required for this field",
    });
  });

  it("preserves a safe Raycast AI error detail", async () => {
    const request = vi.fn(async () => {
      throw new Error("Selected model is unavailable");
    });

    await expect(new RaycastAiClient(request, () => true).ask("private prompt")).rejects.toMatchObject({
      provider: "raycast",
      kind: "request-failed",
      message: "Raycast AI request failed: Selected model is unavailable",
    });
  });

  it("redacts the prompt from Raycast AI error details", async () => {
    const request = vi.fn(async () => {
      throw new Error("Request rejected for private prompt");
    });

    let message = "";
    try {
      await new RaycastAiClient(request, () => true).ask("private prompt");
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("Request rejected for [redacted]");
    expect(message).not.toContain("private prompt");
  });

  it("classifies an aborted request", async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => {
      controller.abort();
      throw new Error("cancelled");
    });

    await expect(new RaycastAiClient(request, () => true).ask("prompt", controller.signal)).rejects.toMatchObject({
      provider: "raycast",
      kind: "aborted",
      message: "AI generation was cancelled",
    });
  });
});
