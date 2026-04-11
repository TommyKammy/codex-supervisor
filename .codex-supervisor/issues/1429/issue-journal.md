# Issue #1429: Separate stale configured-bot review blockers from generic manual_review

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1429
- Branch: codex/issue-1429
- Workspace: .
- Journal: .codex-supervisor/issues/1429/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f19c80a5a65b7f1e21b6463cb173ce5ea43fb55f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-11T07:50:30.355Z

## Latest Codex Summary
- Added a dedicated `stale_review_bot` blocked reason for stale configured-bot review blockers on the current head, kept mixed/manual review on `manual_review`, verified the focused review-blocker tests plus `npm run build`, and opened draft PR #1434 from commit `f0eae38`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The stale configured-bot path was already distinguishable in failure-context generation, but `blockedReasonFromReviewState` still collapsed it into `manual_review`.
- What changed: Added `stale_review_bot` to blocked-reason types/validators, introduced `staleConfiguredBotReviewThreads(...)`, routed only clean-lane same-head stale configured-bot blockers to the new reason, preserved mixed human+bot blockers as `manual_review`, reused lifecycle classification when repeated tracked-PR failures stop on the same stale bot blocker, committed the change as `f0eae38`, and opened draft PR #1434.
- Current blocker: none
- Next exact step: Wait for CI/review on PR #1434 or address any follow-up failures if they appear.
- Verification gap: Full repo test suite not run; focused issue verification and `npm run build` are green.
- Files touched: src/core/types.ts; src/review-thread-reporting.ts; src/pull-request-state-policy.ts; src/supervisor/supervisor.ts; src/codex/codex-output-parser.ts; src/supervisor/execution-metrics-schema.ts; src/supervisor/replay-corpus-validation.ts; src/pull-request-state-policy.test.ts; src/review-thread-reporting.test.ts; src/supervisor/supervisor-pr-review-blockers.test.ts
- Rollback concern: `stale_review_bot` is a new persisted reason code, so any downstream logic that intentionally special-cases only `manual_review` may need explicit expansion if future behavior should treat stale bot blockers identically.
- Last focused command: `git push -u origin codex/issue-1429 && gh pr create --draft --base main --head codex/issue-1429 ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
