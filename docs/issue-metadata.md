# Issue Metadata

Use this document as the canonical reference for execution-ready issue metadata.

It explains which fields `codex-supervisor` reads, how scheduling uses them, and what a good issue body should look like. Keep `README.md` and getting-started docs lightweight; put detailed field rules and examples here.

Trust boundary note: GitHub-authored issue bodies, PR review comments, review summaries, and related GitHub text are execution inputs. They tell the supervisor and Codex what to do next, so they are part of the execution-safety trust boundary rather than neutral metadata.

## Canonical fields

These fields are the core metadata format for execution-ready work:

- `Part of: #...`
- `Depends on: #...`
- `Parallelizable: Yes/No`
- `## Execution order`
- `## Acceptance criteria`
- `## Verification`

`## Summary` and `## Scope` are also strongly recommended because they tell Codex what to change and what must remain unchanged.

## Field reference

### `Part of`

Use `Part of: #42` to point at the parent epic or tracking issue.

- Use one parent issue for a sequenced set of child issues.
- Child issues should use `Part of: #42` to associate with an epic.
- Prefer the `Part of: #...` form in new issues for consistency.
- The parser still accepts the legacy `Part of #42` form.

### `Depends on`

Use `Depends on: #41` for prerequisites that must be closed before this issue can run.

- Do not use `Depends on: #42` when `#42` is only the parent epic; reserve `Depends on` for real execution prerequisites.
- List every true prerequisite, not just the most recent one.
- Use comma-separated issue numbers when there are multiple dependencies.
- Prefer `Depends on` even when `Execution order` also implies the sequence.

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

### `Execution order`

Use this when sibling issues under the same parent must run in a specific sequence.

```md
## Execution order
2 of 4
```

- The first number is this issue's position.
- The second number is the total number of sequenced sibling issues.
- Use it together with `Part of`.

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
- `Acceptance criteria` and `Verification` make the issue execution-ready for implementation and review.
- `Parallelizable` is documentation today; it does not override explicit dependencies.

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
- Keep acceptance criteria behavior-focused.
- Keep verification concrete.

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
- acceptance criteria describe the intended behavior
- verification steps are concrete
- the issue can be understood without guessing from chat history
