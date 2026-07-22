# Development Guidelines

## Technology

- Use strict TypeScript, React, `@raycast/api`, and `@raycast/utils`.
- Prefer Raycast APIs and Node.js built-ins before adding dependencies. Add a package only when it removes meaningful complexity, and document why it is needed.
- Keep modules focused and dependencies minimal. Do not introduce Redux, React Query, a DI container, or another framework without a demonstrated requirement.

## TypeScript

- Keep all strict compiler checks enabled. Do not use `any`; accept untrusted values as `unknown` and narrow them explicitly.
- Avoid non-null assertions and unsafe type casts. Runtime-validate data from storage, forms, files, AI, and HTTP before treating it as a domain type.
- Model variants with discriminated unions. Handle every union and enum exhaustively with a `never` check.
- Prefer immutable values, `readonly` fields, pure functions, and explicit return types on exported functions.
- Prefer literal unions over enums unless an external API requires an enum.
- Keep imports at module scope, use `import type` for type-only dependencies, and avoid circular dependencies.
- Prefer named exports. Use default exports only where Raycast requires them for command entry points.
- Catch errors as `unknown`, narrow or normalize them, and preserve the original error as `cause`. Never leave an empty `catch`.

## Code Formatting

- Treat Prettier as the single source of truth for code layout. Do not hand-format against the formatter.
- Keep the project `.prettierrc` aligned with Raycast conventions: `printWidth: 120`, `singleQuote: false`, `semi: true`, `tabWidth: 2`, and `trailingComma: "es5"` unless the repository config already differs.
- Use ESLint with `@raycast/eslint-config` as the baseline for style and Raycast-specific rules. Avoid personal rule overrides unless they solve a concrete project problem.
- Run `npm run lint` before handoff. Fix lint issues in changed files; use auto-fix when safe.
- Prefer `npm run build` or the repository formatting script when present. Do not commit unformatted code.
- Use UTF-8, LF line endings, and a final newline in text files. Do not commit trailing whitespace.
- Name command entry files with `.tsx` when the command renders UI; use `.ts` for non-UI modules.
- Keep one primary export per command entry file. Use `kebab-case` for filenames and `PascalCase` for React components.
- Order imports in this sequence: Node built-ins, external packages, Raycast packages, internal absolute/relative imports. Separate groups with a blank line.
- Sort named imports alphabetically within each import statement when Prettier does not already define otherwise.
- Prefer a single blank line between top-level declarations. Do not add decorative blank lines inside small functions.
- Break long argument lists and JSX props across lines when they exceed the print width; let Prettier decide the final wrapping.
- Keep JSX readable: one prop per line only when the element is already multiline or readability clearly improves.
- Use double quotes for strings and JSX attributes to match the default Prettier/Raycast setup.
- Use template literals for interpolation; use regular string concatenation only when it improves readability for very short pieces.
- Write user-facing UI copy in US English. Keep comments and commit messages in English.
- Do not mix unrelated formatting-only edits into feature changes. Format only the files you touched, unless the user explicitly asks for a formatting pass.

## Architecture

- Use a functional core with an imperative shell. Domain logic must be deterministic and free from Raycast, filesystem, storage, AI, and network dependencies.
- Keep dependency flow inward: UI and adapters may depend on domain contracts; domain modules must not depend on infrastructure.
- Represent infrastructure behind small interfaces and inject simple implementations or fakes. Avoid service locators and global mutable singletons.
- Separate domain errors from UI presentation. Translate typed errors into toasts or form messages only at the Raycast boundary.
- Create abstractions only after a real second use case appears. Prefer straightforward code over speculative flexibility.

## React and Raycast

- Use function components and call hooks only at the top level.
- Keep state local and minimal; derive values instead of duplicating them. Use `useReducer` and discriminated actions for multi-step workflows.
- Avoid using `useEffect` as an event handler or for chains of dependent state updates. Start mutations from explicit actions and callbacks.
- Prefer `useForm` for forms and validation, `usePromise` for asynchronous work, and `useCachedPromise` only when stale-while-revalidate behavior is useful.
- Render a view immediately; expose progress with `isLoading` and failures with actionable toasts.
- Prefer native Raycast components, built-in actions, confirmation alerts, and conventional keyboard shortcuts.
- Do not add `useMemo`, `useCallback`, or caching without a measured rendering or computation problem.

## Asynchronous Work

- Every cancellable operation must accept an `AbortSignal`. Cancel obsolete work and guard state updates with an operation ID so stale results cannot win races.
- Await or explicitly handle every promise. Do not use async callbacks with `forEach`.
- Use `Promise.all` only for atomic groups. Use `Promise.allSettled` when independent work may partially succeed.
- Bound concurrency when the number of external requests is user-controlled.
- Prevent duplicate concurrent mutations and restore a retryable UI state after failure.

## Data, API, and Security

- Version persisted data, runtime-validate it on read, and implement explicit migrations. Never silently replace invalid data with a destructive empty state.
- Store secrets only in Raycast password preferences. Never write secrets or authorization headers to logs, fixtures, snapshots, or user-facing errors.
- Use HTTPS, explicit timeouts, cancellation, status checks, and defensive response parsing for HTTP calls.
- Sanitize generated filenames, prevent path traversal, and require confirmation before overwriting files.
- Log only diagnostic metadata required for support; avoid logging user content, AI prompts, and generated cards.

## Testing and Maintenance

- Unit-test pure domain behavior with table-driven cases. Test adapters at their contracts using fakes for Raycast APIs, storage, AI, filesystem, and HTTP.
- Cover malformed external data, migrations, cancellation, races, partial failures, retries, and non-success HTTP responses.
- Test observable behavior rather than private implementation details; avoid snapshots for business logic.
- Add a focused regression test for every fixed bug.
- Keep changes narrow and do not mix feature work with unrelated cleanup.
- Before handoff, run formatting, linting, type checking, tests, and `ray build`; report any check that could not be run.
- Update technical documentation when setup, public contracts, dependencies, or maintenance procedures change.
- Write code comments in English. Communicate with the user in Russian.
