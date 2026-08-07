<p align="center">
  <img src="./media/extension-icon.png" width="150" height="150" />
</p>

# Mochi Cards

Create and edit [Mochi](https://mochi.cards/) flashcards from Raycast with reusable templates, Markdown, and optional AI fields.

## Features

- Create cards from reusable templates instead of rebuilding the same layout each time.
- Fill a card with `<<variables>>` and generate selected parts with AI.
- Preview and edit the result before saving it to Mochi.
- Browse, edit, and find duplicate cards in selected Mochi decks.

## Configuration

- In Mochi, open **Account Settings** to view and manage your API keys.
- Add a Mochi API key in the extension preferences in Raycast. Raycast stores it as a password preference.
- Run **Configure AI Provider** to select one global provider for all templates: Raycast AI, OpenAI API, Google Gemini API, Anthropic Claude API, or a Custom AI provider.
- Raycast AI is the default and requires Raycast AI access only when a template contains `<ai>` blocks.
- For an external provider, enter its API key and choose a model from the provider's searchable model list. You can also enter a model ID manually when it is not listed.
- Choosing a model validates the API key by loading the models available to it. API keys are stored in macOS Keychain; model IDs and the selected provider are stored in Raycast extension storage.
- Settings for inactive providers remain saved and reappear when you switch back to them.
- Templates without `<ai>` blocks do not require AI provider configuration.

Create external API keys at [OpenAI](https://platform.openai.com/api-keys), [Google AI Studio](https://aistudio.google.com/apikey), or the [Anthropic Console](https://console.anthropic.com/settings/keys). ChatGPT Plus, Claude Pro, and consumer Gemini subscriptions do not automatically include API access or API billing.

The contents of each `<ai>` prompt, including substituted template values, are sent to the selected provider. API keys are sent only in provider authorization headers.

### Custom AI provider

Custom AI targets any OpenAI-compatible Chat Completions API: [Ollama](https://ollama.com) (`http://localhost:11434/v1`), [LM Studio](https://lmstudio.ai) (`http://localhost:1234/v1`), [OpenRouter](https://openrouter.ai) (`https://openrouter.ai/api/v1`), and similar servers.

- **Provider Name** is a display label only (e.g. "Ollama"); it does not affect the request.
- **Base URL** must be a plain `http`/`https` URL with no credentials, query string, or fragment. Requests go to `{Base URL}/chat/completions` and, when browsing models, `{Base URL}/models`.
- **Model ID** is sent as-is in the request body; use "Browse Models" to pick one from `{Base URL}/models` when the server supports it.
- **Headers JSON** is a flat JSON object of string values (e.g. `{"Authorization": "Bearer sk-..."}`) sent with every request. It is stored in macOS Keychain as a single secret; Provider Name, Base URL, and Model ID are stored in Raycast extension storage.
- Custom AI does not support thinking/reasoning configuration or streaming; it sends `max_tokens: 4096` on every request.
- Plain `http` is accepted only for loopback hosts such as `localhost` and `127.0.0.1`. Remote endpoints must use `https` so prompts and credentials are encrypted in transit.
