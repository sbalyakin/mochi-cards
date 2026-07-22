---
name: seb-commit
description: Perform the full guarded git commit workflow for this repository. Use when the user asks to commit current work, save changes to git, or run a commit flow that uses the existing staged scope, stages all changes only when the index is empty, proposes a commit message, waits for explicit approval, and creates the commit.
---

# Commit Workflow
Run a guarded commit flow. Use the git index as the commit source of truth.

## Setup
- Read `.agents/rules/commit-message-generation.md` before message generation.
- Use numbered text gates, never `AskQuestion`. After a gate, end the reply and
  wait so queued `1` or `2` messages can answer it.

## Git state
Run once:

```bash
staged_paths="$(git diff --cached --name-only)"
unstaged_paths="$(git diff --name-only)"
untracked_paths="$(git ls-files --others --exclude-standard)"
mixed_paths="$(comm -12 \
  <(printf '%s\n' "$staged_paths" | LC_ALL=C sort) \
  <(printf '%s\n' "$unstaged_paths" | LC_ALL=C sort))"

has_staged=$([ -n "$staged_paths" ] && echo true || echo false)
has_unstaged=$([ -n "$unstaged_paths$untracked_paths" ] && echo true || echo false)
printf 'has_staged=%s\nhas_unstaged=%s\n' "$has_staged" "$has_unstaged"
```

If `mixed_paths` is non-empty, report those paths and stop. Do not parse
`git status --short`.

## Workflow
1. **Select the commit scope.**
  - If `has_staged=false` and `has_unstaged=false`, tell the user there are no changes to commit and stop.
  - **Existing staged snapshot:** If `has_staged=true`, use the current staged index as the selected commit scope. Do not ask to stage, restage, or include any unstaged or untracked changes from other files.
  - **Empty index with working tree changes:** If `has_staged=false` and `has_unstaged=true`, use all current changes as the intended commit scope.
  - Do not list changed files or add explanatory text. Ask in chat using this
    layout, translated to the user's language:

    ```text
    Stage all changes?

    Actions:
    1. Continue
    2. Cancel
    ```

  - End the reply immediately after showing the options and wait.
  - If the user answers `2`, stop without making changes.
  - If the user answers `1`, stage everything: `git add -A`
  - If the user sends any other numeric answer, restate the same options and wait.
  - Use the resulting staged index as the selected commit scope.

2. **Generate the commit message.**
  - Follow `.agents/rules/commit-message-generation.md` in `staged` scope mode.
  - Generate and fully validate one commit message for that exact snapshot
    before requesting approval.
  - Store the exact result as `proposed_message`. Do not display it until step 3.

3. **Get message approval.**
  - Display the approval gate using exactly this layout, translated to the
    user's language:

    ````markdown
    Proposed commit message:

    ```text
    <proposed_message>
    ```

    Actions:
    1. Approve
    2. Regenerate

    Or send a custom commit message.
    ````

  - The code fence is presentation only and is not part of `proposed_message`.
  - Keep every heading, option, and instruction on its own line. Never combine
    the action list with the custom-message instruction.
  - End the reply immediately after showing the options and wait.
  - If the user answers `1`, approve `proposed_message` and continue.
  - If the user answers `2`, generate and validate one new message, replace
    `proposed_message`, display it with the same options, and wait again.
  - If the user sends any other numeric answer, restate the same options and wait.
  - If the user provides a custom message, use it exactly. Do not rewrite it unless the user explicitly asks.

4. **Create the commit.**
  - Create the git commit with the approved message.
  - After commit, report:
    - the final commit message
    - the created commit hash

## Guardrails
- Do not skip the approval step.
- Do not auto-approve the commit message.
- Commit only the exact staged snapshot that was approved.
- Do not stage more changes after message approval.
- Do not include extra explanation in the final success message unless needed.
- If user approval is required, stop and wait.
