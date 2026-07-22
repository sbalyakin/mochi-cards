When suggesting commit messages for this repository, always follow these rules.

# Main format

Use this format:

<scope>: <subject>

# Language

- Write commit messages in English only.
- Use imperative mood when natural.
- Keep the subject concise, specific, and factual.
- Start the subject with an uppercase letter.
- Do not end the subject with a period.

# Subject length

- Keep the entire first line at 72 characters or fewer.
- Prefer compact wording without losing meaning.
- Omit routine implementation details instead of moving them into a body.

# Scope selection

Choose the narrowest meaningful scope based on the changed subsystem.

## Available scopes

### 1. Production subsystems
- `templates`: Manage Templates command, template form, and template CRUD UI.
- `generation`: Generate Card command, variable input form, and generation workflow wiring.
- `preview`: Markdown preview, regeneration actions, manual edit, copy, and save flows.
- `engine`: Template parser, template engine, segment assembly, and variable substitution.
- `validation`: Template validation rules and structured validation errors.
- `storage`: Template repository, LocalStorage persistence, and data migrations.
- `mochi`: Mochi API client, authentication, and card submission.
- `raycast-ai`: Raycast AI adapter, AI field execution, and access checks.
- `commands`: Raycast command entry points and manifest wiring when not owned by a specific feature.
- `ui`: Shared Raycast components or presentation not owned by a more specific subsystem.

### 2. Architectural fallback scopes
- `domain`: Cross-subsystem business logic, models, policies, and pure functions.
- `services`: Shared infrastructure adapters not covered by a specific subsystem.
- `core`: Comparable changes across multiple architectural layers with no dominant subsystem.

### 3. Repository and infrastructure
- `tests`: Test-only changes, fixtures, and mocks.
- `build`: package.json, Raycast manifest, TypeScript config, and build tooling.
- `scripts`: Repository automation not owned by build, tests, or AI workflows.
- `ai`: Agent rules, skills, and Cursor, Claude, or Codex configuration.
- `docs`: README, concept/plan updates, and architecture documentation.
- `chore`: Gitignore, editor metadata, and local maintenance with no more specific scope.

## Scope rules
- Use one scope only.
- Prefer specific subsystem scopes over broader layer scopes.
- If a change spans multiple subsystems, choose the dominant one from the user-visible or architectural perspective.
- Use the production scope when production code and its tests change together.
- Use `tests` only when the selected scope contains no production behavior change.
- Use `build` for package manifests, Raycast extension configuration, and build automation.
- Use `scripts` only when the script is not better described by `build`, `tests`, or `ai`.
- Use `core` only when multiple architectural layers change comparably and no subsystem dominates.
- Use `chore` only when no production, architectural, test, build, script, AI, or documentation scope fits.
- Do not use change types such as `fix`, `refactoring`, or `cleanup` as scopes.

# Message style

Prefer describing the actual behavioral or architectural outcome, not low-level edits.

# Special cases

For purely local cleanup with no meaningful subsystem, use:
- chore: Remove unused gitignore patterns

For documentation-only changes, use:
- docs: Document Mochi API key setup in README

# Body rules

Do not add a body by default. Add a body only when the subject would otherwise hide important information that is not obvious from the diff itself.

A body is allowed only when at least one of these is true:
- the commit has an important user-visible caveat or behavior change
- the change has a non-obvious limitation, compatibility concern, or rollback risk
- the behavior differs across apps, environments, or runtime modes
- the commit introduces a significant architectural decision or tradeoff
- the commit changes public API, persisted config format, or external protocol
- the commit requires special migration or follow-up work

Body rules:
- use short bullet points
- include only non-obvious information
- do not restate the diff or list implementation steps
- do not mention file or type names unless essential to understanding the impact
- for agent rules, skills, commit workflows, documentation, tests, formatting,
  and routine refactoring, use a subject line only unless there is an explicit
  migration, compatibility, security, or rollback concern

# Output rules

When asked to generate a commit message:
- return only the final commit message unless additional explanation is requested
- include a body when needed by the rules above
- do not return multiple options unless explicitly requested
- do NOT wrap the output in markdown code blocks (```) or quotes
- choose the most specific scope supported by the changes

# Examples

**Good:**
engine: Parse AI fields into stable generation segments

**Good:**
preview: Regenerate a single AI field without rebuilding the card

**Good (Body included for non-obvious migration caveat):**
storage: Change persisted template envelope version

- Existing LocalStorage data is not migrated automatically

**Bad (Uses Conventional Commits format):**
feat(engine): parse AI fields -> **Do not use parentheses or feat/fix prefixes.**

**Bad (Past tense, ends with period, capitalized scope):**
Engine: Parsed AI fields. -> **Scope must be lowercase, use imperative mood, no period.**
