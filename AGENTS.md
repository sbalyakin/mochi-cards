# AI Agent Rules (Canonical)

## Priority (lower number wins)

1. User request in the active session.
2. This file.
3. `.agents/rules/karpathy-rules.md` (behavioral defaults: think first, simplicity, surgical changes, goal-driven execution).
4. `.agents/rules/development-guidelines.md` (TypeScript, React, Raycast, architecture, testing, and maintenance).
5. Tool/platform safety constraints.

## Communication

- Lead with the result or action. Add context only when it adds value.
- Keep output concise: start with the substance and stop when the answer is complete.
- Comments in code: English. Chat with the user: language of the user's last message.

## Map

- Layers: `src/<command>.tsx` UI entry points, `src/<command>.ts` no-view entry points (name = `package.json` `commands[].name`); `domain/` logic without runtime infrastructure imports (ports injected); `services/` adapters (Mochi, AI providers, Keychain, files); `storage/` repositories (LocalStorage, file lock); `components/` shared UI.
- Extension AI (provider, model, reasoning, max tokens, timeouts): settings: `configure-ai.tsx` → `storage/raycast-ai-settings-repository.ts` (wires LocalStorage + Keychain) → `storage/ai-settings-repository.ts`; clients: `services/ai-client-factory.ts` (used by `configure-ai.tsx`, `components/card-preview.tsx`, `regenerate-cards-worker.ts`) → `services/<provider>-ai-client.ts` → `services/ai-http-client.ts` (HTTP providers only; timeouts, errors, redaction); Raycast uses `AI.ask`. `AiClient` contract: `domain/template-engine.ts`; callers: `domain/generation-session.ts`, `configure-ai.tsx` (connection test).
- Provider-specific bug: ask the user which provider, base URL, and model are configured, or for the Copy Error text from Configure AI, before picking an adapter.
- Card creation: `generate-card.tsx` → `components/generation-input-form.tsx` → `components/card-preview.tsx` (initial generation runs inside `useEffect`).
- Data export/import: `components/extension-data-transfer-forms.tsx` → `domain/extension-data-transfer.ts`, `storage/extension-data-validation.ts`; import takes the bulk-regeneration lock (`storage/regeneration-lock-repository.ts`).
- Local installs: `npm run dev` (`ray develop`) builds into `~/.config/raycast/extensions/mochi-cards`; TinyCast `~/Library/Application Support/com.tinycast.app/extensions/mochi-cards` symlinks to it (reopen the command after rebuild; TinyCast's Node `fs` shim lacks `linkSync`).
- Agent tooling, not extension AI: `AGENTS.md`, `CLAUDE.md`, `opencode.json`, `.agents/`.
