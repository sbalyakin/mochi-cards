# AI Agent Rules (Canonical)

Apply equally to English and Russian output.

## Priority (lower number wins)

1. User request in the active session.
2. This file.
3. `.agents/rules/karpathy-rules.md` (behavioral defaults: think first, simplicity, surgical changes, goal-driven execution).
4. `.agents/rules/development-guidelines.md` (TypeScript, React, Raycast, architecture, testing, and maintenance).
5. Project knowledge base.
6. Tool/platform safety constraints.

## Communication

- Lead with the result or action. Add context only when it adds value.
- Keep output concise: start with the substance and stop when the answer is complete.
- Comments in code: English. Chat with the user: language of the user's last message.
