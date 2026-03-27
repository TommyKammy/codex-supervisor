# Issue #1137: Promote missed focused test regressions from post-merge audit history into actionable follow-up candidates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1137
- Branch: codex/issue-1137
- Workspace: .
- Journal: .codex-supervisor/issues/1137/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dbce5077f9abffec6e9fe31497d05985dc072d6f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T22:37:20.379Z

## Latest Codex Summary
- Added post-merge audit `followUpCandidates` for missed focused test regressions sourced from persisted external-review miss artifacts, with merged issue/PR traceability and advisory-only follow-up metadata.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The missing product behavior was confined to `summarizePostMergeAuditPatterns`, which preserved advisory promotion history but never loaded persisted `regressionTestCandidates` from `external_review_misses_path`.
- What changed: Bumped the post-merge audit summary schema to v4, added validated `followUpCandidates`, loaded regression-test candidates from external-review miss artifacts, added a focused reproducer plus contract test updates, and opened draft PR #1141.
- Current blocker: none.
- Next exact step: Monitor draft PR #1141 and address any review or CI follow-up.
- Verification gap: None in the approved focused targets; broader unrelated suites remain unrun.
- Files touched: `.codex-supervisor/issues/1137/issue-journal.md`, `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `src/backend/supervisor-http-server.test.ts`.
- Rollback concern: Low; the behavior is additive and advisory-only, but consumers expecting schema v3 would need the corresponding v4 field.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts`
### Scratchpad
- Reproducer before fix: `summary.followUpCandidates === undefined` for a post-merge artifact with a persisted regression-test miss candidate.
- Focused verification: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts`, `npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts`, `npx tsx --test src/supervisor/post-merge-audit-artifact.test.ts`, `npx tsx --test src/backend/supervisor-http-server.test.ts`.
