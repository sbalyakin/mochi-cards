# Mochi Cards

Mochi Cards lets you create and edit [Mochi](https://mochi.cards/) flashcards from Raycast. You make a reusable template once, fill in a small form, check the result, and send the card to a Mochi deck.

Templates can produce a Markdown card or fill the fields of a Mochi template. They also support optional AI prompts, which are useful for translations, examples, definitions, and similar text that you do not want to write by hand every time.

## What you can do

- Create cards from reusable templates instead of rebuilding the same layout each time.
- Insert values from the form into a card with `<<variables>>`.
- Generate selected parts of a card with Raycast AI.
- Preview, edit, and regenerate the result before it reaches Mochi.
- Browse cards in chosen decks and edit cards that use a Mochi template.

## Before you start

You need:

- macOS and [Raycast](https://www.raycast.com/)
- a Mochi account and API key
- Raycast AI access only if your templates contain `<ai>` blocks

In Mochi, open **Account Settings** to view and manage your API keys.

## Create your first card

1. Open **Manage Templates** and create a template.
2. Add the inputs you want to fill in, choose a Mochi deck, and write the card body or map values to a Mochi template.
3. Open **Create Card**, choose the template, and fill in the form.
4. Select **Generate Preview**. The extension replaces variables, runs any AI prompts, and shows the finished card.
5. Edit the preview if needed, then send it to Mochi.

For example, a vocabulary template can ask for a word and a context, then create a card like this:

```markdown
# <<word>>

---

Context: <<context>>
```

The first input in every template is its primary field. It is required, can contain text or a number, and cannot be removed or moved. When you use a specific Mochi template, this input becomes the card's `name` field.

To help avoid duplicates, the extension compares the primary field with cached card names. With a specific Mochi template, a match appears while you type and **Generate Preview** asks for confirmation before continuing. For Markdown cards, the extension derives a name from the final rendered Markdown and warns before saving. Mochi's response supplies the name kept in the local cache.

## Write templates

A template has a name, input fields, a deck, and an output mode. You can also set tags, reverse review, and archived status. Inputs can be text, numbers, or checkboxes. Put their names between `<<` and `>>` anywhere in the card body or in a custom field mapping.

Variable names must be unique, start with a letter, and contain only letters, numbers, and `_`.

Valid names: `word`, `source_language`, `example_context`

Invalid names: `source language`, `1word`, `word-name`

Optional text and number inputs may be empty. A checkbox becomes `true` or `false`. Empty values do not remove the surrounding Markdown automatically.

### Add AI-generated text

Put an AI prompt inside `<ai>` and `</ai>` tags. The extension fills variables first, sends the prompt to Raycast AI, then replaces the whole block with the response.

```markdown
# <<word>>

---

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

Each block is a separate request. You can regenerate one bad translation without changing the rest of the card. AI blocks are independent and can run in parallel. The response is final text, so `<<word>>` or `<ai>` appearing inside a response are not processed again.

### Choose where the card goes in Mochi

The template form loads your decks and Mochi templates automatically.

Choose one of these output modes:

- **No Template** sends the rendered Markdown as a plain Mochi card without applying a Mochi template. It is selected by default.
- **Default Deck Template** sends the rendered Markdown and lets Mochi use the template configured for that deck.
- A specific **Mochi template** sends values to the fields you map in the template editor. The card body is empty in this mode.

For a specific Mochi template, the primary field is always mapped to Mochi's `name` field. Other unmapped fields are left out.

## Review before sending

The preview is the place to check and adjust the card. You can:

- add the card to Mochi
- edit the generated Markdown or mapped field values
- regenerate all AI fields or only one field
- return to the input form and change values
- copy Markdown or save it as a Markdown file when the output is a Card Body

Editing generated text manually disables regeneration for that text until you restore the generated version. Returning to the input form clears existing AI results because the inputs may have changed.

When you save a card, the extension resolves every variable and AI block locally. Neither `<<variables>>` nor `<ai>` tags are sent to Mochi.

## Edit cards you already created

Use **Browse Cards** to choose the decks you want to see. Open a card backed by a Mochi template and select **Edit Card**.

The edit form restores the template and its original input values when that information is available. It uses the same preview flow as creating a card. You can change the generation template or choose another live Mochi template, then select **Update Card in Mochi** only after reviewing the result.

Before an update, the extension reloads the card from Mochi. If the card changed since you opened the editor, it asks before applying your generated fields to the latest version. With the same Mochi template, fields your generation template does not manage are preserved. If you switch Mochi templates, the extension sends only fields that belong to the new template. It does not change the card's deck, tags, archive state, position, or reviews.

## Find duplicate cards

In **Browse Cards**, select a deck and choose **Find Duplicate Cards**. The extension reloads the deck from Mochi and groups cards that share the same name. Case, surrounding and repeated whitespace, and Unicode composition are ignored, so `Second Name` and `second   name` land in the same group.

Each group is shown as a section with the name of the oldest card and the number of cards in it. Cards run from oldest to newest and show their creation date, review count, and archived state. Archived cards are included. From a group you can open, edit, copy, or delete a card. After a deletion the groups are recalculated, and a group disappears once only one card is left.

Only the selected deck is checked. Child decks are not included, and only exact matches of the normalized name count as duplicates.

## Validation and limits

The extension checks templates before generation. It reports problems such as:

- `Unknown variable: <<translation>>`
- `Unclosed <ai> field`
- `Nested <ai> fields are not supported`

It also checks variable names, empty AI blocks, empty Markdown card bodies, and missing deck selections.

The template language is deliberately small. It supports `<<variable>>` placeholders and `<ai>...</ai>` blocks. It does not support conditionals, loops, filters, default values, nested AI blocks, references between AI blocks, embedded code, or Mochi field types such as transcription and draw.

## Commands

- **Create Card** creates a card from a reusable template.
- **Manage Templates** creates, edits, duplicates, and deletes templates.
- **Browse Cards** shows cards from selected decks, opens compatible cards for editing, and finds duplicate cards in a deck.

## Development

Install dependencies and start the development extension:

```bash
npm install
npm run dev
```

In Raycast, enable the development extension and add a key in the extension preferences. Raycast stores the key as a password preference. It is not stored in templates or unfinished forms.

While `npm run dev` is running, open the extension through Raycast's **Manage Extensions** screen.

The test suite uses Vitest, so it runs the strict TypeScript domain and adapter tests directly without a separate emitted test build.

```bash
npm run build
npm run lint
npm run typecheck
npm test
```
