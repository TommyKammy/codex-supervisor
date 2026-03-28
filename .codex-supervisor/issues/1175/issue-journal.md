# Issue #1175: Broaden bounded fail-soft continuation for transient full-inventory failures

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1175
- Branch: codex/issue-1175
- Workspace: .
- Journal: .codex-supervisor/issues/1175/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 86005fa77638f1585e7a54dc7376af9ad830030a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T14:35:47.121Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Repeated transient full-inventory refresh failures were still flowing through degraded tracked-PR reconciliation and degraded active-issue continuation because only snapshot-backed new selection was bounded by first-failure tolerance.
- What changed: Added a persisted `bounded_continuation_allowed` bit on `inventory_refresh_failure`, derived it only for first transient failures with a fresh snapshot, reused that state in shared inventory-refresh policy helpers, hard-blocked exhausted transient continuation in `runOnceCyclePrelude` and `resolveRunnableIssueContext`, and added regression coverage plus state-store roundtrip coverage.
- Current blocker: none
- Next exact step: Commit the bounded transient fail-soft continuation change on `codex/issue-1175` and prepare the branch for draft PR/update if requested.
- Verification gap: `tsc -p tsconfig.json --noEmit` could not run cleanly in this worktree because local TypeScript deps/types are not installed and the repo tsconfig currently triggers a TS 6 deprecation error under ad hoc `npm exec`.
- Files touched: .codex-supervisor/issues/1175/issue-journal.md; src/core/types.ts; src/core/state-store.ts; src/core/state-store.test.ts; src/inventory-refresh-state.ts; src/run-once-cycle-prelude.ts; src/run-once-cycle-prelude.test.ts; src/run-once-issue-selection.ts; src/run-once-issue-selection.test.ts
- Rollback concern: Low to moderate; the main policy risk is over-blocking degraded continuation if future callers expect repeated transient failures to keep using the prior fail-soft path without a fresh bounded allowance.
- Last focused command: npm exec --yes -- tsx --test src/core/state-store.test.ts src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
