const HORIZONTAL_RULE_TAG = /<hr\s*\/?>/gi;

export function renderRaycastMarkdown(markdown: string): string {
  return markdown.replace(HORIZONTAL_RULE_TAG, "\n\n---\n\n");
}
