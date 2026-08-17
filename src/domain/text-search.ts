const COMBINING_MARKS_PATTERN = /\p{M}+/gu;
const NON_WORD_CHARACTER_PATTERN = /[^\p{L}\p{N}\p{M}_]+/gu;

export type TextSearchOptions = {
  /** Treats "λόγος" and "λογος" as the same word. Off by default. */
  readonly ignoreAccents: boolean;
};

/**
 * Folds a string for accent-insensitive search: strips combining marks
 * (Greek tonos, Latin acutes, umlauts, …) and lowercases the rest.
 */
export function foldSearchText(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS_PATTERN, "").normalize("NFC").toLocaleLowerCase();
}

export function matchesSearchText(
  text: string,
  query: string,
  options: TextSearchOptions = { ignoreAccents: false }
): boolean {
  const normalize = options.ignoreAccents ? foldSearchText : (value: string) => value.toLocaleLowerCase();
  const normalizedQuery = normalize(query).trim();
  if (!normalizedQuery) {
    return true;
  }
  return normalize(text).includes(normalizedQuery);
}

export function startsWithSearchTextWord(
  text: string,
  query: string,
  options: TextSearchOptions = { ignoreAccents: false }
): boolean {
  const normalize = options.ignoreAccents ? foldSearchText : (value: string) => value.toLocaleLowerCase();
  const normalizedQuery = normalize(query).trim();
  if (!normalizedQuery) {
    return true;
  }
  const normalizedText = normalize(text);
  if (normalizedText.startsWith(normalizedQuery)) {
    return true;
  }
  return [...normalizedText.matchAll(NON_WORD_CHARACTER_PATTERN)].some((match) =>
    normalizedText.startsWith(normalizedQuery, match.index + match[0].length)
  );
}
