import { describe, expect, it, vi } from "vitest";

import type { CardTemplate } from "../domain/template";
import { isMochiDeckNotFoundError, MochiClient, MochiError, type FetchLike } from "./mochi-client";

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

  it("deletes a card", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response("", { status: 200 }));
    const client = new MochiClient("secret-key", fetch);

    await client.deleteCard("card-1");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://app.mochi.cards/api/cards/card-1");
    expect(init?.method).toBe("DELETE");
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("secret-key:").toString("base64")}`,
    });
    expect(init?.body).toBeUndefined();
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

  it("recognizes missing deck errors", () => {
    expect(isMochiDeckNotFoundError(new MochiError("http", "Not found", 404))).toBe(true);
    expect(isMochiDeckNotFoundError(new MochiError("validation", "deck-id is invalid", 422))).toBe(true);
    expect(isMochiDeckNotFoundError(new MochiError("network", "offline"))).toBe(false);
  });

  it("recognizes a missing deck response while listing cards", async () => {
    const client = new MochiClient(
      "key",
      async () => new Response(JSON.stringify({ errors: { "deck-id": "deck was not found" } }), { status: 422 })
    );
    let caughtError: unknown;

    try {
      await client.listCards("deleted-deck");
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toMatchObject({ message: "deck-id: deck was not found" });
    expect(isMochiDeckNotFoundError(caughtError)).toBe(true);
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

  it("loads every page of cards for a deck", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bookmark: "next-page",
            docs: [
              {
                id: "card-1",
                "deck-id": "deck-1",
                content: "# Hello",
                name: "Hello",
                tags: ["greeting"],
                fields: { front: { id: "front", value: "Hello" } },
                "created-at": { date: "2026-07-21T10:00:00.000Z" },
                pos: "A",
                reviews: [{ date: { date: "2026-07-22T00:00:00.000Z" } }],
                "component-cache": {
                  ai: {
                    "Explain hello.": { text: "Hello explanation", date: "2026-07-23" },
                  },
                },
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            docs: [
              {
                id: "card-2",
                "deck-id": "deck-1",
                content: "# World",
                name: null,
                "archived?": true,
                "template-id": "template-1",
              },
            ],
          })
        )
      );
    const client = new MochiClient("key", fetch);

    await expect(client.listCards("[[deck-1]]")).resolves.toEqual([
      {
        id: "card-1",
        deckId: "deck-1",
        content: "# Hello",
        name: "Hello",
        tags: ["greeting"],
        fields: [{ id: "front", value: "Hello" }],
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: undefined,
        position: "A",
        reviews: [{ date: "2026-07-22T00:00:00.000Z" }],
        aiCacheEntries: [{ prompt: "Explain hello.", text: "Hello explanation", date: "2026-07-23" }],
        archived: undefined,
        templateId: undefined,
      },
      {
        id: "card-2",
        deckId: "deck-1",
        content: "# World",
        name: null,
        tags: [],
        fields: [],
        createdAt: undefined,
        updatedAt: undefined,
        position: undefined,
        reviews: [],
        aiCacheEntries: [],
        archived: true,
        templateId: "template-1",
      },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://app.mochi.cards/api/cards/?deck-id=deck-1&limit=100",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://app.mochi.cards/api/cards/?deck-id=deck-1&limit=100&bookmark=next-page",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("loads every page of templates and sorts them", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bookmark: "next-page",
            docs: [
              {
                id: "template-2",
                name: "Words",
                content: "# << Word >>",
                fields: { word: { id: "word" } },
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ docs: [{ id: "template-1", name: "Greek" }] })));
    const client = new MochiClient("key", fetch);

    await expect(client.listTemplates()).resolves.toEqual([
      { id: "template-1", name: "Greek", content: undefined, fields: [] },
      {
        id: "template-2",
        name: "Words",
        content: "# << Word >>",
        fields: [{ id: "word", name: "word" }],
      },
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

  it("excludes trashed cards", async () => {
    const client = new MochiClient(
      "key",
      async () =>
        new Response(
          JSON.stringify({
            docs: [
              { id: "active-card", "deck-id": "deck-1", content: "# Active" },
              {
                id: "trashed-card",
                "deck-id": "deck-1",
                content: "# Trashed",
                "trashed?": { date: "2026-07-18T20:11:14.657Z" },
              },
            ],
          })
        )
    );

    await expect(client.listCards("deck-1")).resolves.toEqual([expect.objectContaining({ id: "active-card" })]);
  });

  it("rejects invalid card responses", async () => {
    const client = new MochiClient("key", async () => new Response(JSON.stringify({ docs: "invalid" })));

    await expect(client.listCards("deck-1")).rejects.toMatchObject({
      kind: "http",
      message: "Mochi returned an invalid card list",
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
