# Mochi Cards

Raycast extension for Mochi flashcards on macOS. You write the template, pick which parts are AI-generated, fill in a few variables, preview the card, and send it to your deck.

The extension does not invent card structure for you. Your Markdown template is the layout. AI only runs inside tagged blocks you define.

## Requirements

- macOS with [Raycast](https://www.raycast.com/)
- A [Mochi](https://mochi.cards/) account and API key
- Raycast AI access (used for `<ai>` fields)

## Local installation

```bash
npm install
npm run dev
```

Open Raycast, enable the development extension, and enter the Mochi API key in the extension preferences. The key is stored as a Raycast password preference; templates and unfinished form state never contain it.

## How it works

1. Create a template with variables, Markdown body, and a Mochi deck ID.
2. Run **Generate Card**, pick a template, and fill the form.
3. The extension substitutes `<<variables>>`, calls AI for each `<ai>` block, and shows a preview.
4. Regenerate one field, edit the Markdown by hand, or send the card to Mochi.

```
Template + variable values
  → variable substitution
  → AI field processing
  → preview
  → Mochi API
```

Each `<ai>` block is a separate request. If one translation comes back wrong, you can regenerate just that block without touching the rest of the card.

## Template syntax

A template has a name, a list of variables, Markdown content, and a Mochi deck ID. Optional fields include tags, `review-reverse?`, and `archived?`.

Deck IDs can be pasted either as `xuMPFbpj` or as a Mochi link `[[xuMPFbpj]]`; surrounding brackets are removed automatically.

### Variables

Variables are plain text. Declare them in the template settings, then reference them with placeholders:

```markdown
# <<word>>

Context: <<context>>
```

Names must be unique, non-empty, start with a letter, and use only letters, digits, and `_`.

Examples: `word`, `source_language`, `example_context`

Invalid: `source language`, `1word`, `word-name`

Empty values are allowed. They replace the placeholder with an empty string. Sections with empty variables are not removed automatically.

### AI fields

Wrap the prompt in `<ai>` tags. Everything inside is sent to AI after variable substitution. The response replaces the whole block.

```markdown
# <<word>>

## Translation

<ai>
Translate the Greek word <<word>> into Russian.
Consider this context: <<context>>
Return only the translation.
</ai>

## Example

<ai>
Write a simple A1 sentence with <<word>>.
On the next line, add the Russian translation.
</ai>
```

AI fields are processed independently, in document order. Variables are substituted before any AI call. AI output is not parsed again as a template, so text like `<<word>>` or `<ai>` in a response stays plain text.

## Preview actions

After generation you can:

- **Add to Mochi** — send the finished Markdown to your deck
- **Edit Markdown** — tweak the card by hand (this disables per-field regeneration until you restore the last generated version)
- **Regenerate All AI Fields** — rerun every `<ai>` block
- **Regenerate AI Field** — rerun a single block
- **Back to Input** — change variable values (this invalidates all AI results)
- **Copy Markdown**
- **Save as Markdown File**

## Sending to Mochi

Confirmed cards are posted to the Mochi API as regular Markdown in `content`. The extension does not use Mochi templates. Placeholders and `<ai>` tags never leave your machine.

The request explicitly sends `"template-id": null`, so a default template configured on the target deck is not applied.

```http
POST https://app.mochi.cards/api/cards/
```

```json
{
  "content": "...",
  "deck-id": "..."
}
```

Store your Mochi API key in Raycast preferences. The extension uses HTTP Basic Auth with the API key as the username and an empty password.

Templates are stored locally in a versioned Raycast `LocalStorage` record. If that record is malformed or from an unsupported version, the extension reports the problem and leaves the original data unchanged.

## Template validation

Templates are checked before generation. Common errors:

- `Unknown variable: <<translation>>`
- `Unclosed <ai> field`
- `Nested <ai> fields are not supported`

The validator also checks variable name rules, empty AI fields, empty templates, and missing deck IDs.

## What is not supported (v1)

The template language is intentionally small:

- `<<variable>>` placeholders
- `<ai>...</ai>` blocks

Not supported: conditionals, loops, filters, default values, typed variables, nested `<ai>` tags, references between AI fields, Mochi dynamic fields, or embedded code.

## Commands

- **Generate Card** — pick a template and create a card
- **Manage Templates** — create, edit, duplicate, and delete templates

## Development

Open the extension in Raycast with **Manage Extensions** while `npm run dev` is running.

Useful scripts:

Vitest is used so the strict TypeScript domain and adapter tests run directly without maintaining a separate emitted test build.

```bash
npm run build
npm run lint
npm run typecheck
npm test
```
