# AGENTS.md

This repository uses GitHub issue bodies as execution inputs. Treat issue authoring as part of the product's safety boundary.

## Canonical source

- Before creating or updating a `codex` issue, follow [`docs/issue-metadata.md`](docs/issue-metadata.md).
- If README examples, chat instructions, and issue history disagree, prefer [`docs/issue-metadata.md`](docs/issue-metadata.md).

## Required format for `codex` issues

When creating or updating a `codex`-labeled GitHub issue, always ensure the body contains:

- `## Summary`
- `## Scope`
- `## Acceptance criteria`
- `## Verification`
- `Depends on: ...`
- `Parallelizable: Yes|No`
- `## Execution order`

Additional rule:

- Add `Part of: #...` when the issue is a sequenced child issue.
- Do not add `Part of:` for a standalone `1 of 1` issue unless the issue truly belongs to an epic and the current readiness rules require it.

## Safe defaults

For standalone `codex` issues, use:

```md
Depends on: none
Parallelizable: No

## Execution order
1 of 1
```

For sequenced child issues, use:

```md
Part of: #123
Depends on: #122
Parallelizable: No

## Execution order
2 of 4
```

## Authoring rules

- Keep one issue to one behavior delta.
- Do not invent dependencies to satisfy the format. Use `Depends on: none` when nothing blocks the issue.
- Do not use the parent epic in `Depends on:` unless the parent is a real blocking prerequisite.
- Use canonical `Part of: #...` syntax, not legacy variants.
- Use `Parallelizable: No` unless you are confident parallel execution is safe.
- For standalone issues, explicitly write `1 of 1`.
- When editing an existing `codex` issue, preserve valid metadata fields and fix missing or malformed ones before assuming the issue is runnable.

## Before you finish issue creation or editing

- Re-read the final body and confirm the scheduling metadata is internally consistent.
- If the issue is meant for the supervisor loop, prefer using the GitHub issue template in `.github/ISSUE_TEMPLATE/codex-execution-ready.md`.
- If there is any doubt about readiness, instruct the operator to run:

```bash
node dist/index.js issue-lint <issue-number> --config /path/to/supervisor.config.json
```

## Do not assume

- Do not assume `Part of:` is optional for sequenced child issues.
- Do not assume `Execution order` can be omitted for standalone `codex` issues.
- Do not assume a previously created issue body is still valid after readiness rules change.
