const COMBINING_MARKS_PATTERN = /\p{M}+/gu;

/**
 * Folds a string for accent-insensitive search: strips combining marks
 * (Greek tonos, Latin acutes, umlauts, …) and lowercases the rest.
 */
export function foldSearchText(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS_PATTERN, "").normalize("NFC").toLocaleLowerCase();
}

export function matchesSearchText(text: string, query: string): boolean {
  const foldedQuery = foldSearchText(query).trim();
  if (!foldedQuery) {
    return true;
  }
  return foldSearchText(text).includes(foldedQuery);
}
