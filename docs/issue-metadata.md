# Issue Metadata

Use this document as the canonical reference for execution-ready issue metadata.

It explains which fields `codex-supervisor` reads, how scheduling uses them, and what a good issue body should look like. Keep `README.md` and getting-started docs lightweight; put detailed field rules and examples here.

Trust boundary note: GitHub-authored issue bodies, PR review comments, review summaries, and related GitHub text are execution inputs. They tell the supervisor and Codex what to do next, so they are part of the execution-safety trust boundary rather than neutral metadata.

## Start here

If you are new to `codex-supervisor`, do not start by inventing your own structure. Copy one finished example first, then replace the placeholders.

## What `codex` issues must contain

Every execution-ready `codex` issue needs:

- `## Summary`
- `## Scope`
- `## Acceptance criteria`
- `## Verification`
- one canonical `Depends on: none` or `Depends on: #...` line
- one canonical `Parallelizable: Yes|No` line
- one valid `Execution order` declaration, including `1 of 1` for standalone work
- one canonical `Part of: #...` line when the issue is part of a sequenced child set

Safe default for a first standalone issue:

- `Depends on: none`
- `Parallelizable: No`
- `Execution order: 1 of 1`

Only add `Part of: #...` when the issue is a sequenced child under an epic or tracking issue.

Path hygiene reminder: do not embed raw workstation-local absolute path literals like `/Users/...`, `/home/...`, or `C:\Users\...` directly in issue text, tests, fixtures, or examples when placeholders or fragment-based strings would verify the same behavior.

## Copy-paste examples

Standalone `codex` issue:

```md
## Summary
Add issue-lint guidance to the getting-started guide so first-time operators can fix issue bodies before `run-once`.

## Scope
- add a short preflight checklist before `run-once`
- explain how to read the most common `issue-lint` failures
- keep deeper troubleshooting details in the reference docs

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- the getting-started guide shows the minimal authoring and validation loop before first run
- beginners can tell whether they should edit the issue body or inspect host/config diagnostics

## Verification
- review the getting-started flow for clarity
- `npm run build`
```

Sequenced child issue:

```md
## Summary
Add issue-lint repair guidance to the operator dashboard so the browser shows what to fix before an issue is treated as runnable.

## Scope
- surface issue-lint repair guidance near the focused issue details
- keep the dashboard using the existing typed supervisor service boundary
- leave the safe command surface unchanged

Part of: #42
Depends on: #41
Parallelizable: No

## Execution order
2 of 4

## Acceptance criteria
- the focused issue details show the same repair guidance the CLI reports
- operators can see whether the current issue is blocked by issue metadata before running the loop again

## Verification
- `npm test -- src/backend/webui-dashboard.test.ts`
- `npm run build`
```

Fast validation loop:

```bash
node dist/index.js issue-lint 123 --config /path/to/supervisor.config.json
```

Use `issue-lint` before `run-once` whenever you are unsure whether an issue is truly execution-ready.

## Canonical fields

These fields are the core metadata format for execution-ready work:

- `Part of: #...`
- `Depends on: #...`
- `Parallelizable: Yes/No`
- `## Execution order`
- `## Summary`
- `## Scope`
- `## Acceptance criteria`
- `## Verification`

For `codex`-labeled issues, readiness checks fail closed when required scheduling metadata is missing, duplicated, conflicting, or malformed.

## Bad examples first

These are the most common ways a beginner writes an issue body that looks reasonable in GitHub but still stops the loop.

Missing standalone scheduling metadata:

```md
## Summary
Do the work.

## Scope
- keep it small

## Acceptance criteria
- behavior is correct

## Verification
- `npm test -- path/to/test.ts`
```

Why it fails:

- standalone `codex` issues still need `Depends on: none`, `Parallelizable: Yes/No`, and `Execution order: 1 of 1`

Non-canonical child metadata:

```md
Part of #42
Depends on: #41
Parallelizable: No

## Execution order
2 of 4
```

Why it fails:

- use canonical `Part of: #42` for sequenced `codex` child issues
- the metadata parser may still accept some legacy forms for backward compatibility, but readiness checks for sequenced `codex` child issues require the canonical `Part of: #...` line

Missing `Depends on`:

```md
## Summary
Ship the fix.

## Scope
- update the queue selection path

Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- the queue selects the expected issue

## Verification
- `npm test -- src/run-once-issue-selection.test.ts`
```

Why it fails:

- `codex` issues must say whether they are blocked; use `Depends on: none` when nothing blocks the issue

Missing `Parallelizable`:

```md
## Summary
Ship the fix.

## Scope
- update the queue selection path

Depends on: none

## Execution order
1 of 1

## Acceptance criteria
- the queue selects the expected issue

## Verification
- `npm test -- src/run-once-issue-selection.test.ts`
```

Why it fails:

- `codex` issues should always declare `Parallelizable: Yes/No` explicitly

Missing `Execution order`:

```md
## Summary
Ship the fix.

## Scope
- update the queue selection path

Depends on: none
Parallelizable: No

## Acceptance criteria
- the queue selects the expected issue

## Verification
- `npm test -- src/run-once-issue-selection.test.ts`
```

Why it fails:

- standalone `codex` issues still need `Execution order: 1 of 1`

Duplicate scheduling metadata:

```md
Depends on: none
Depends on: #41
Parallelizable: No

## Execution order
1 of 1
```

Why it fails:

- scheduling metadata must be unambiguous; duplicates and conflicts fail closed

Vague verification:

```md
## Verification
- run tests
```

Why it fails:

- verification should point to a concrete command, test file, or manual check target

## Read `issue-lint` like this

Representative blocking output:

- `missing_required=scope, acceptance criteria, verification`
- `metadata_errors=depends on must appear exactly once; execution order must appear exactly once; parallelizable must appear exactly once`
- `metadata_errors=depends on duplicates parent epic #900; remove it and keep only real blocking issues`
- `metadata_errors=issue labels are missing; cannot evaluate label-gated execution policy`

How to react:

- `missing_required=...`
  Add the missing sections to the issue body.
- `metadata_errors=...`
  Replace invalid or duplicate metadata lines with one correct declaration for each field.
- `repair_guidance_N=Add ...`
  Follow that guidance literally; it is the fastest repair path.
- labels missing
  Refresh the issue payload or labels before trusting the result.

## Field reference

### `Part of`

Use `Part of: #42` to point at the parent epic or tracking issue.

- Use one parent issue for a sequenced set of child issues.
- Child issues should use `Part of: #42` to associate with an epic.
- Use the canonical `Part of: #...` form for new issues and for any `codex`-labeled child issue.
- The metadata parser may still accept some legacy forms for backward compatibility, but readiness checks for sequenced `codex` child issues require the canonical `Part of: #...` line.

### `Depends on`

Use `Depends on: #41` for prerequisites that must be closed before this issue can run.

- Do not use `Depends on: #42` when `#42` is only the parent epic; reserve `Depends on` for real execution prerequisites.
- List every true prerequisite, not just the most recent one.
- Use comma-separated issue numbers when there are multiple dependencies.
- Prefer `Depends on` even when `Execution order` also implies the sequence.
- Use `Depends on: none` when nothing blocks the issue.

### Epic / child pattern

When child issues belong to an epic, use `Part of` for the parent relationship and `Depends on` only for sibling or non-epic prerequisites.

Recommended:

```md
Part of: #42
Depends on: #41

## Execution order
2 of 4
```

Discouraged:

```md
Part of: #42
Depends on: #42

## Execution order
2 of 4
```

### `Parallelizable`

Use `Parallelizable: No` unless you are confident the issue can run alongside related work without conflict.

- `No` is the safe default.
- `Yes` communicates intent to operators and future scheduling logic.
- Do not use this field as a substitute for `Depends on`.
- `codex`-labeled issues should always declare this field explicitly.

### `Execution order`

Use this when sibling issues under the same parent must run in a specific sequence.

```md
## Execution order
2 of 4
```

- The first number is this issue's position.
- The second number is the total number of sequenced sibling issues.
- Use it together with `Part of`.
- For standalone `codex` issues, use `1 of 1` so scheduling metadata stays explicit.

### `Acceptance criteria`

Use acceptance criteria for the concrete behavior that must be true when the issue is done.

- Keep the bullets observable and testable.
- Prefer behavior statements over implementation notes.
- Include preserved behavior when regressions are a risk.

### `Verification`

Use verification steps for the exact commands or manual checks that prove the issue is done.

- Prefer concrete commands such as `npm test -- src/issue-metadata.test.ts`.
- Name the test file, command, or manual target directly.
- Avoid vague steps like `run tests` unless the next bullet makes them concrete.

## How scheduling uses the fields

The supervisor is readiness-driven across the matching open backlog. It does not just pick the newest issue; it pages through matching open issues using the configured candidate discovery fetch window as the page size, then selects the first runnable issue in deterministic order.

- `Depends on` blocks an issue while any listed dependency is still open.
- `Part of` plus `Execution order` blocks later siblings until earlier siblings are done.
- `Summary`, `Scope`, `Acceptance criteria`, and `Verification` make the issue execution-ready for implementation and review.
- `Parallelizable` is documentation today; it does not override explicit dependencies.

For `codex`-labeled issues, readiness checks fail closed when required scheduling metadata is missing, duplicated, conflicting, or malformed.

Operator expectation: a correctly authored older issue should remain discoverable even when it starts beyond the first page. If selection looks wrong in a large backlog, confirm the metadata before assuming candidate discovery skipped it.

When in doubt, make the dependency explicit. A conservative queue is better than an ambiguous one.

## Changed-file classification

The supervisor also uses a small deterministic changed-file classification layer for path-based policy decisions.

- `workflow`: files under `.github/workflows/`
- `docs`: files under `docs/` plus common documentation extensions such as `.md`
- `tests`: files in `test/`, `tests/`, `__tests__/`, or files ending in `.test.*` or `.spec.*`
- `schema`: schema and migration paths such as `prisma/schema.prisma`, `db/`, or `migrations/`
- `infrastructure`: deployment and environment paths such as `infra/`, `terraform/`, `helm/`, `k8s/`, `docker/`, or `Dockerfile`
- `backend`: the fallback for application and backend code that does not match a narrower class

Classification is deterministic and precedence-based. The current order is `workflow`, `docs`, `tests`, `schema`, `infrastructure`, then fallback `backend`.

## Authoring guidance

Use the issue body to remove ambiguity before execution starts.

- Put the problem statement in `## Summary`.
- Use `## Scope` for what changes and what stays unchanged.
- Use `Depends on` for prerequisites and `Execution order` for sibling sequencing.
- For standalone `codex` issues, write `Depends on: none`, `Parallelizable: No|Yes`, and `Execution order: 1 of 1`.
- Keep acceptance criteria behavior-focused.
- Keep verification concrete.
- Run `issue-lint` against the issue number before the first `run-once` when you want a quick sanity check.

If an issue touches risky areas, spell out the guardrails in scope or acceptance criteria rather than relying on implicit repo knowledge.
If the issue or review text comes from an untrusted source, do not rely on metadata quality alone to make autonomous execution safe.

## Issue body template

```md
## Summary
Add a persisted recommendation severity model so wait stats findings rank consistently.

## Scope
- define severity levels in the domain model
- update recommendation ranking to use the new severity model
- keep existing finding ingestion behavior unchanged

Part of: #42
Depends on: #41
Parallelizable: No

## Execution order
2 of 4

## Acceptance criteria
- severity levels are defined in the domain model
- recommendation ranking uses the new severity model
- focused tests cover the ranking behavior

## Verification
- `npm test -- src/recommendation-ranking.test.ts`
```

## Example review checklist

Before handing an issue to the supervisor, check that:

- dependencies are explicit
- execution order is present when sibling order matters
- standalone `codex` issues still declare `Depends on`, `Parallelizable`, and `Execution order`
- acceptance criteria describe the intended behavior
- verification steps are concrete
- the issue can be understood without guessing from chat history
