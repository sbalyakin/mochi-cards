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

  it("posts the selected Mochi template ID", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response("", { status: 201 }));
    const client = new MochiClient("secret-key", fetch);

    await client.createCard("# Card", template({ mochiTemplateId: "mochi-template-1" }));

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ "template-id": "mochi-template-1" });
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

  it("loads every page of decks and sorts them", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ bookmark: "next-page", docs: [{ id: "deck-2", name: "Words" }] }))
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ bookmark: "next-page", docs: [{ id: "deck-1", name: "Greek" }] }))
      );
    const client = new MochiClient("key", fetch);

    await expect(client.listDecks()).resolves.toEqual([
      { id: "deck-1", name: "Greek" },
      { id: "deck-2", name: "Words" },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://app.mochi.cards/api/decks",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://app.mochi.cards/api/decks?bookmark=next-page",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("loads every page of templates and sorts them", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ bookmark: "next-page", docs: [{ id: "template-2", name: "Words" }] }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ docs: [{ id: "template-1", name: "Greek" }] })));
    const client = new MochiClient("key", fetch);

    await expect(client.listTemplates()).resolves.toEqual([
      { id: "template-1", name: "Greek" },
      { id: "template-2", name: "Words" },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://app.mochi.cards/api/templates/",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://app.mochi.cards/api/templates/?bookmark=next-page",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("rejects invalid deck responses", async () => {
    const client = new MochiClient("key", async () => new Response(JSON.stringify({ docs: "invalid" })));

    await expect(client.listDecks()).rejects.toMatchObject({
      kind: "http",
      message: "Mochi returned an invalid deck list",
    });
  });

  it("wraps network errors", async () => {
    const client = new MochiClient("key", async () => {
      throw new Error("offline");
    });

    await expect(client.createCard("card", template())).rejects.toMatchObject({ kind: "network", message: "offline" });
  });
});

function template(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return {
    id: "template-1",
    name: "Greek",
    fields: [],
    content: "# Card",
    deckId: "[[deck-1]]",
    deckName: "Greek",
    mochiTemplateId: null,
    tags: ["greek"],
    reviewReverse: true,
    archived: false,
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}
