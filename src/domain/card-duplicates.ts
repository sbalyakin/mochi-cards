export type NamedCard = {
  readonly id: string;
  readonly name: string | null;
};

export function findDuplicateCardByName(cards: readonly NamedCard[], candidateName: string): NamedCard | undefined {
  const normalizedCandidate = normalizeCardName(candidateName);
  if (!normalizedCandidate) {
    return undefined;
  }
  return cards.find((card) => card.name !== null && normalizeCardName(card.name) === normalizedCandidate);
}

export function normalizeCardName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}
