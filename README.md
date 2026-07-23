# Mochi Cards

Raycast extension for Mochi flashcards on macOS. Build cards from a Markdown body or map typed inputs to fields in an existing Mochi template.

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

1. Create a local template with typed inputs, a Mochi deck, and either a Markdown Card Body or Mochi field mappings.
2. Run **Create Card**, pick a template, and fill the form.
3. The extension substitutes `<<variables>>`, calls AI for each `<ai>` block, and shows a preview.
4. Regenerate one AI field, edit the generated output, or send the card to Mochi.

```
Template + variable values
  → variable substitution
  → AI field processing
  → preview
  → Mochi API
```

Each `<ai>` block is a separate request. If one translation comes back wrong, you can regenerate just that block without touching the rest of the card.

## Template syntax

A template has a name, typed input fields, a Mochi deck, and an output mode. **No Template** renders the saved Card Body. Selecting a Mochi template maps local inputs or custom generated values to its fields. Tags, reverse review, and archived status are optional.

The template form loads decks from `GET https://app.mochi.cards/api/decks` and Mochi templates from `GET https://app.mochi.cards/api/templates/`. The internal IDs are used only when sending a card to Mochi. `No Template` is selected by default.

### Variables

Inputs can be text, number, or boolean. Declare them in the template settings, then reference their names with placeholders in Card Body or custom mappings:

```markdown
# <<word>>

Context: <<context>>
```

Names must be unique, non-empty, start with a letter, and use only letters, digits, and `_`.

Examples: `word`, `source_language`, `example_context`

Invalid: `source language`, `1word`, `word-name`

Empty optional text and number values are allowed. Boolean placeholders render as `true` or `false`. Sections with empty inputs are not removed automatically.

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

- **Add to Mochi** — send the active Card Body or mapped Mochi field values to your deck
- **Edit Markdown / Edit Field Values** — tweak generated output by hand (this disables regeneration until you restore the generated version)
- **Regenerate All AI Fields** — rerun every `<ai>` block
- **Regenerate AI Field** — rerun a single block
- **Back to Input** — change variable values (this invalidates all AI results)
- **Copy Markdown** and **Save as Markdown File** — available for Card Body output

## Sending to Mochi

Confirmed cards use one of two request shapes. Card Body mode sends rendered Markdown in `content` and omits `template-id` and `fields`:

```http
POST https://app.mochi.cards/api/cards/
```

```json
{
  "content": "...",
  "deck-id": "..."
}
```

Mochi template mode sends empty `content`, the selected `template-id`, and only mapped fields. Text and number values are JSON strings; boolean values remain JSON booleans. Unmapped fields are omitted.

```json
{
  "content": "",
  "deck-id": "...",
  "template-id": "template-id",
  "fields": {
    "front-field-id": {
      "id": "front-field-id",
      "value": "Rendered field value"
    },
    "boolean-field-id": {
      "id": "boolean-field-id",
      "value": true
    }
  }
}
```

Placeholders and `<ai>` tags are resolved locally and never appear in either payload.

Store your Mochi API key in Raycast preferences. The extension uses HTTP Basic Auth with the API key as the username and an empty password.

Templates are stored locally in a versioned Raycast `LocalStorage` record. If that record is malformed or from an unsupported version, the extension reports the problem and leaves the original data unchanged.

## Template validation

Templates are checked before generation. Common errors:

- `Unknown variable: <<translation>>`
- `Unclosed <ai> field`
- `Nested <ai> fields are not supported`

The validator also checks variable name rules, empty AI fields, empty templates, and missing deck selections.

## What is not supported (v1)

The template language is intentionally small:

- `<<variable>>` placeholders
- `<ai>...</ai>` blocks

Not supported: conditionals, loops, filters, default values, nested `<ai>` tags, references between AI fields, embedded code, or mapping Mochi field types such as transcription and draw.

## Commands

- **Create Card** — pick a template and create a card
- **Manage Templates** — create, edit, duplicate, and delete templates
- **Browse Cards** — choose visible decks and browse their cards with a detail preview

Browse Cards caches the Mochi deck and template catalog locally. Use **Reload Decks** to refresh it explicitly.
Card lists are also cached per deck: cached cards appear immediately, then refresh from Mochi in the background and
update in the open list when they change. An empty or missing cache is loaded from Mochi normally.

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
