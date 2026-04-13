# Issue #1476: Bug: reply_and_resolve can resolve stale configured-bot threads but leave tracked PR blocked as stale_review_bot

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1476
- Branch: codex/issue-1476
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 61e880ba3a0899dbe631a4f92c6a8b158f742e95
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-13T08:58:18.407Z

## Latest Codex Summary
- Added a focused reproducer for same-head `reply_and_resolve` convergence and fixed post-turn tracked PR reconciliation so successful stale configured-bot auto-resolution refreshes GitHub facts before returning.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `maybeCommentOnTrackedPrPersistentStatus()` returned immediately after persisting `reply_and_resolve` progress, so the tracked record kept local `blocked_reason=stale_review_bot` even though a fresh same-head GitHub snapshot would already be clear.
- What changed: Added a focused regression test in `src/post-turn-pull-request.test.ts` that requires a third same-head snapshot after `reply_and_resolve`; extracted tracked PR lifecycle application into `applyTrackedPrLifecycleState()` and reused it after successful same-head `reply_and_resolve` to refresh state and re-run persistent-status commenting on fresh GitHub facts.
- Current blocker: none.
- Next exact step: commit the verified fix on `codex/issue-1476`.
- Verification gap: none for the requested local scope; targeted suite and build are green.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`.
- Rollback concern: low to moderate; the new post-auto-resolution refresh is intentionally limited to same-head `reply_and_resolve` stale-review cases, but any future broadening should avoid introducing extra snapshot churn for `reply_only` or already-settled blockers.
- Last focused command: `npm run build`
### Scratchpad
- Reproducer command: `node --test --import tsx src/post-turn-pull-request.test.ts --test-name-pattern "refreshes tracked PR state after reply_and_resolve clears stale configured-bot threads"`
- Targeted verification: `node --test --import tsx src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`
- Keep this section short. The supervisor may compact older notes automatically.
