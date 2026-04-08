# Issue #1352: Bug: keep fix_blocked same-PR repair behind GitHub review gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1352
- Branch: codex/issue-1352
- Workspace: .
- Journal: .codex-supervisor/issues/1352/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 589172407e2267af4407d21a155c8cd37ea06da6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T11:34:04.180Z

## Latest Codex Summary
- Reproduced the retry-lane precedence bug with focused `pull-request-state-policy` regressions, then fixed `localReviewHighSeverityNeedsRetry()` so current-head `fix_blocked` retries stay behind the same GitHub review gates as same-PR repair. Focused tests and `npm run build` now pass.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `inferStateFromPullRequest()` was letting current-head `fix_blocked` records bypass GitHub review gates because the high-severity retry branch ran before the guarded same-PR repair lane.
- What changed: Added regressions for `fix_blocked` + `localReviewHighSeverityAction=\"retry\"` under `REVIEW_REQUIRED` and `CHANGES_REQUESTED`, added a clean-lane approval regression, and narrowed `localReviewHighSeverityNeedsRetry()` so `fix_blocked` only retries when `reviewDecisionAllowsSamePrRepair(pr)` is true.
- Current blocker: none
- Next exact step: Stage the focused code/test changes and create a checkpoint commit on `codex/issue-1352`.
- Verification gap: none for local focused coverage; targeted tests and full TypeScript build passed.
- Files touched: `src/pull-request-state-policy.test.ts`, `src/review-handling.test.ts`, `src/review-handling.ts`, `.codex-supervisor/issues/1352/issue-journal.md`
- Rollback concern: low; change is scoped to the retry eligibility helper and only alters current-head `fix_blocked` behavior when GitHub review is still blocking same-PR repair.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
