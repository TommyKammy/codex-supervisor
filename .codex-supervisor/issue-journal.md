# Issue #1612: Classify no-actionable current-head configured-bot reviews as stale review blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1612
- Branch: codex/issue-1612
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d3d579515c2c6c696e9fae33a4cef7446edeb66a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-21T13:43:55.881Z

## Latest Codex Summary
- Reclassified same-head configured-bot threads with an explicit current-head no-actionable signal into the `stale_review_bot` path, then tightened regression coverage across selector, policy, tracked-PR persistence, and explain surfaces.

## Active Failure Context
- Resolved: stale same-head configured-bot blockers with a current-head informational success signal were staying on the generic non-actionable `manual_review` path.

## Codex Working Notes
### Current Handoff
- Hypothesis: When the configured bot reports an explicit current-head success/no-actionable signal, lingering bot-owned same-head unresolved threads should route through stale-review recovery instead of the generic non-actionable manual-review bucket.
- What changed: `staleConfiguredBotReviewThreads` now considers configured-bot threads stale when the current head has an explicit no-actionable signal (`configuredBotCurrentHeadObservedAt` + `configuredBotCurrentHeadStatusState=SUCCESS` + no top-level actionable strength), and failure-context selection now prefers the stale-review context before the generic non-actionable manual-review context.
- Current blocker: none
- Next exact step: open or update the PR for `codex/issue-1612` if the supervisor wants an early draft PR checkpoint.
- Verification gap: none for the requested local bundle; targeted regressions and `npm run build` both passed.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/review-thread-reporting.ts`; `src/supervisor/supervisor-failure-context.ts`; `src/review-thread-reporting.test.ts`; `src/pull-request-state-policy.test.ts`; `src/supervisor/supervisor-pr-review-blockers.test.ts`; `src/supervisor/supervisor-diagnostics-explain.test.ts`
- Rollback concern: The new stale path intentionally stays fail-closed unless the PR has an explicit current-head success observation with no actionable top-level configured-bot signal; if that inference is too broad, revert the `staleConfiguredBotReviewThreads` expansion.
- Last focused command: `npx tsx --test src/github/github-review-signals.test.ts src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
