# Commit Message Generation

Follow `.agents/rules/commit-message.md` exactly.

During commit-message generation, do not inspect git history,
run `git log`, run `git status`, or calculate staged or unstaged booleans.

The calling workflow selects one scope mode:

- `staged`: use the current staged snapshot only
- `automatic`: prefer the staged snapshot; use all working tree changes only
  when the staged snapshot is empty

## Inspect staged scope

Run this command exactly once:

```bash
git diff --cached --stat --patch
```

If the output is non-empty, it is the complete selected scope. Generate the
message immediately when the diff provides enough context. Do not verify it
with another diff or status command. Use the context fallback below only when
the diff is insufficient for an accurate message.

If the output is empty:

- in `staged` mode, report that the selected scope has no changes
- in `automatic` mode, inspect working tree scope

## Inspect working tree scope

Run:

```bash
git diff --stat --patch
git ls-files --others --exclude-standard
```

Read the listed untracked files as needed.

## Context fallback

Use the selected diff as the primary source.

Only if the diff is insufficient to determine the behavioral intent accurately:

1. For a staged modified or added file, read its complete staged version:
   `git show ":path/to/file"`
2. For a staged deleted file, read its previous version:
   `git show "HEAD:path/to/file"`
3. For working tree scope, read the complete changed or untracked file.
4. If still necessary, read only directly related files referenced by the
   changed code.

Do not inspect unrelated files, git history, status, or additional diffs.
Do not treat context files as part of the commit scope.
Stop gathering context as soon as one accurate commit message can be generated.

## Final validation

Before returning the message, validate every item:

1. The scope is listed in `.agents/rules/commit-message.md`.
2. Changes under `.agents`, `.cursor`, `.claude`, or `.codex` use `ai`.
3. The entire first line is 72 characters or fewer.
4. The subject starts with an uppercase letter, uses imperative mood when
   natural, and has no trailing period.
5. The message has no body unless a body condition is explicitly satisfied.
6. Any body contains only short bullet points and does not summarize the diff.
7. Agent rule, skill, or commit workflow changes use a subject line only unless
   they introduce an explicit migration, compatibility, security, or rollback
   concern.

If any item fails, rewrite the message silently and validate it again.

Generate exactly one commit message for the selected scope and return it to the
calling workflow.
