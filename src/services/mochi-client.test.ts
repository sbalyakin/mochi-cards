import { describe, expect, it, vi } from "vitest";

import type { CardTemplate } from "../domain/template";
import { MochiClient, type FetchLike } from "./mochi-client";

describe("MochiClient", () => {
  it("posts the expected payload with HTTP Basic authentication", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "card-1" }), { status: 201, headers: { "Content-Type": "application/json" } })
      );
    const client = new MochiClient("secret-key", fetch);

    await expect(client.createCard("# Card", template())).resolves.toEqual({ id: "card-1" });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://app.mochi.cards/api/cards/");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("secret-key:").toString("base64")}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      content: "# Card",
      "deck-id": "deck-1",
      "template-id": null,
      "manual-tags": ["greek"],
      "review-reverse?": true,
      "archived?": false,
    });
  });

  it("distinguishes authentication and validation failures", async () => {
    const unauthorized = new MochiClient("bad", async () => new Response("", { status: 401 }));
    const invalid = new MochiClient(
      "key",
      async () => new Response(JSON.stringify({ message: "deck-id is invalid" }), { status: 422 })
    );

    await expect(unauthorized.createCard("card", template())).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(invalid.createCard("card", template())).rejects.toMatchObject({
      kind: "validation",
      message: "deck-id is invalid",
    });
  });

  it("wraps network errors", async () => {
    const client = new MochiClient("key", async () => {
      throw new Error("offline");
    });

    await expect(client.createCard("card", template())).rejects.toMatchObject({ kind: "network", message: "offline" });
  });
});

function template(): CardTemplate {
  return {
    id: "template-1",
    name: "Greek",
    variables: [],
    content: "# Card",
    deckId: "[[deck-1]]",
    tags: ["greek"],
    reviewReverse: true,
    archived: false,
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
