# Issue #1526: Bug: bound merged_issue_closures reconciliation on large hosts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1526
- Branch: codex/issue-1526
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c18c814661a12a0e18edb80c4061ce4eb8f687c0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T11:47:07.467Z

## Latest Codex Summary
- Added bounded, resumable `merged_issue_closures` reconciliation with persisted cursor state and phase progress propagation, plus focused two-cycle backlog coverage.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileMergedIssueClosures` was still doing an unbounded sweep over every revalidation-eligible closed record because it had no per-cycle budget or persisted cursor, so large hosts always restarted at the beginning of the backlog.
- What changed: Added `merged_issue_closures_last_processed_issue_number` to `reconciliation_state`; bounded `reconcileMergedIssueClosures` to 25 records per pass by default; persisted and resumed a merged-closure cursor across cycles; propagated merged-closure target progress through `runOnceCyclePrelude`; added focused coverage for two-cycle resume behavior and merged-phase progress updates.
- Current blocker: none
- Next exact step: Commit the bounded/resumable reconciliation changes on `codex/issue-1526`.
- Verification gap: none for the requested local scope; existing tests still emit known execution-metrics warning logs in fixtures, but the suites pass.
- Files touched: .codex-supervisor/issue-journal.md; src/core/types.ts; src/recovery-reconciliation.ts; src/run-once-cycle-prelude.ts; src/run-once-cycle-prelude.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor.ts
- Rollback concern: Cursor resume order now prioritizes an active closed issue before the resumed backlog; if reverted, large-host `merged_issue_closures` prelude latency will return to full-scan behavior.
- Last focused command: npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
