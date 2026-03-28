# Issue #1144: Promote fail-closed persisted artifact identity validation before post-merge follow-up promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1144
- Branch: codex/issue-1144
- Workspace: .
- Journal: .codex-supervisor/issues/1144/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dbce5077f9abffec6e9fe31497d05985dc072d6f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T00:25:52.815Z

## Latest Codex Summary
- Added a fail-closed persisted-artifact promotion guardrail for runtime external-review miss artifacts and post-merge audit summaries.
- Focused tests now prove malformed persisted evidence fields are rejected and embedded local-review identity drift is skipped during post-merge summarization.
- Updated local-review shared-memory guidance to treat persisted-artifact promotion as provenance-sensitive.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Persisted artifact promotion was too permissive. Runtime external-review history accepted malformed optional evidence fields, and post-merge audit summarization trusted embedded local-review identity without checking it against the merged context.
- What changed: Added reusable identity/evidence validation helpers, enforced fail-closed validation before promoting persisted external-review miss artifacts, skipped post-merge audit artifacts whose embedded local-review issue/PR/branch/head identity mismatches the authoritative merged context, added focused regression tests, and documented the guardrail in `docs/local-review.md`.
- Current blocker: none
- Next exact step: Commit the validated checkpoint on `codex/issue-1144`, then proceed to PR/update workflow if needed.
- Verification gap: Full repo `npm test` still includes unrelated browser-smoke coverage and was not used for this issue; focused build and targeted suites passed.
- Files touched: docs/local-review.md; src/persisted-artifact-promotion.ts; src/external-review/external-review-miss-artifact.ts; src/external-review/external-review-miss-history.ts; src/external-review/external-review-miss-history.test.ts; src/local-review/repair-context.ts; src/local-review/runner.ts; src/supervisor/post-merge-audit-summary.ts; src/supervisor/post-merge-audit-summary.test.ts; src/supervisor/supervisor-status-rendering.ts
- Rollback concern: Tightened validation now skips malformed or mismatched persisted artifacts instead of promoting them; if older artifacts relied on permissive parsing, operator-facing summaries may surface fewer historical runtime hints until those artifacts are regenerated.
- Last focused command: npx tsx --test src/external-review/external-review-miss-history.test.ts src/supervisor/post-merge-audit-summary.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
