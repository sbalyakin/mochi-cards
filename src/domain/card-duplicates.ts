import type { FieldValues, CardTemplate } from "./template";

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

export function selectDuplicateCandidate(
  template: CardTemplate,
  values: FieldValues,
  mode: "create" | "update",
  renderedMarkdown?: string
): string | undefined {
  if (mode !== "create") {
    return undefined;
  }
  if (template.output.kind === "card-body") {
    return renderedMarkdown === undefined ? undefined : deriveMochiCardName(renderedMarkdown);
  }
  const primaryField = template.fields[0];
  const primaryValue = primaryField ? values[primaryField.id] : undefined;
  return typeof primaryValue === "string" ? primaryValue : undefined;
}

export function deriveMochiCardName(content: string): string {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/gu, "");
  return findMochiCardName(withoutComments.split(/\r?\n/u)) ?? "Untitled card";
}

type MochiFence = {
  readonly marker: "`" | "~";
  readonly length: number;
};

function findMochiCardName(lines: readonly string[]): string | undefined {
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex >= 0) {
    const openingFence = parseMochiFence(lines[firstContentIndex]);
    if (openingFence) {
      return findMochiFencedName(lines, firstContentIndex, openingFence);
    }
  }

  let isInFence = false;

  for (const sourceLine of lines) {
    const fence = /^\s{0,3}(?:`{3,}|~{3,})/u.test(sourceLine);
    if (fence) {
      isInFence = !isInFence;
      continue;
    }
    const name = cleanMochiNameLine(sourceLine, isInFence);
    if (name.trim().length > 0) {
      return name.replace(/^\s+/u, "");
    }
  }

  return undefined;
}

function findMochiFencedName(
  lines: readonly string[],
  openingIndex: number,
  openingFence: MochiFence
): string | undefined {
  const closingIndex = lines.findIndex(
    (line, index) => index > openingIndex && parseMochiFence(line)?.marker === openingFence.marker
  );

  // Mochi closes ```` with ``` and retains extra closing markers in the name. This intentionally differs from CommonMark.
  if (closingIndex < 0) {
    return openingFence.marker;
  }

  const closingFence = parseMochiFence(lines[closingIndex]);
  if (!closingFence) {
    return undefined;
  }
  const name = findMochiCardName(lines.slice(openingIndex + 1, closingIndex));
  const remainingMarkers = openingFence.marker.repeat(Math.max(0, closingFence.length - 3));
  if (name !== undefined) {
    return `${name}${remainingMarkers}`;
  }
  return remainingMarkers || findMochiCardName(lines.slice(closingIndex + 1));
}

function parseMochiFence(line: string): MochiFence | undefined {
  const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { marker: match[1][0] as MochiFence["marker"], length: match[1].length };
}

function cleanMochiNameLine(sourceLine: string, isInFence: boolean): string {
  if (!isInFence && (/^\s{0,3}(?:[-*_]\s*){3,}$/u.test(sourceLine) || /^\s{0,3}(?:=+|-+)\s*$/u.test(sourceLine))) {
    return "";
  }

  let line = sourceLine;
  if (!isInFence) {
    line = line.replace(/^ {4}|^\t/u, "");
  }
  line = line
    .replace(/^\s{0,3}#{1,6}(?:[ \t]+|$)/u, "")
    .replace(/^\s{0,3}>[ \t]?/u, "")
    .replace(/^\s{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/u, "")
    .replace(/^\[[ xX]\][ \t]*/u, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/<(?:(?:https?:|mailto:)[^>\s]+)>/giu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>\n]*>/gu, "")
    .replace(/\*\*|__|~~|\*/gu, "")
    .replace(/`/gu, "");
  return line;
}
