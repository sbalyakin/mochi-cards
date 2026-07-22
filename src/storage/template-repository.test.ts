import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

import type { CardTemplateDraft } from "../domain/template";
import { TemplateRepository, TemplateRepositoryError, type TemplateStorage } from "./template-repository";

class MemoryStorage implements TemplateStorage {
  value: string | undefined;

  async getItem(): Promise<string | undefined> {
    return this.value;
  }

  async setItem(_key: string, value: string): Promise<void> {
    this.value = value;
  }
}

describe("TemplateRepository", () => {
  let storage: MemoryStorage;
  let ids: string[];
  let repository: TemplateRepository;

  beforeEach(() => {
    storage = new MemoryStorage();
    ids = ["id-1", "id-2", "id-3"];
    repository = new TemplateRepository(
      storage,
      () => ids.shift() ?? "fallback-id",
      () => new Date("2026-07-22T10:00:00.000Z")
    );
  });

  it("creates, updates, duplicates, and deletes templates", async () => {
    const created = await repository.create(draft());
    expect(created).toMatchObject({ id: "id-1", name: "Words", updatedAt: "2026-07-22T10:00:00.000Z" });

    const updated = await repository.update(created.id, draft({ name: "Updated" }));
    expect(updated.name).toBe("Updated");

    const duplicate = await repository.duplicate(created.id);
    expect(duplicate).toMatchObject({ id: "id-2", name: "Updated Copy" });
    expect(await repository.list()).toHaveLength(2);

    expect(await repository.delete(created.id)).toBe(true);
    expect(await repository.delete("missing")).toBe(false);
    expect((await repository.list()).map((template) => template.id)).toEqual(["id-2"]);
  });

  it("keeps corrupted storage unchanged", async () => {
    storage.value = "{broken";
    const original = storage.value;

    await expect(repository.list()).rejects.toBeInstanceOf(TemplateRepositoryError);
    expect(storage.value).toBe(original);
  });

  it("migrates version 1 templates without exposing deck IDs as names", async () => {
    const created = await repository.create(draft({ deckId: " [[deck-1]] " }));
    expect(created.deckId).toBe("deck-1");

    storage.value = JSON.stringify({
      version: 1,
      templates: [{ ...created, deckId: "[[legacy-deck]]", deckName: undefined }],
    });

    expect((await repository.list())[0]).toMatchObject({ deckId: "legacy-deck", deckName: "Unknown deck" });
  });

  it("rejects an unsupported storage version without overwriting it", async () => {
    storage.value = JSON.stringify({ version: 3, templates: [] });

    await expect(repository.create(draft())).rejects.toMatchObject({ kind: "corrupted-data" });
    expect(JSON.parse(storage.value)).toEqual({ version: 3, templates: [] });
  });
});

function draft(overrides: Partial<CardTemplateDraft> = {}): CardTemplateDraft {
  return {
    name: "Words",
    variables: [{ name: "word", label: "Word", required: true }],
    content: "# <<word>>",
    deckId: "deck-1",
    deckName: "Vocabulary",
    tags: [" vocabulary ", "vocabulary"],
    reviewReverse: false,
    archived: false,
    ...overrides,
  };
}
