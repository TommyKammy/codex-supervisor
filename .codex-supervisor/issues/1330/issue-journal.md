# Issue #1330: Route opted-in follow_up_eligible residuals into same-PR local_review_fix

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1330
- Branch: codex/issue-1330
- Workspace: .
- Journal: .codex-supervisor/issues/1330/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0c755117a29d61b72b201f9358956613f6864ccd
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T12:24:02.665Z

## Latest Codex Summary
- Added focused regression coverage for opted-in `follow_up_eligible` residuals and routed current-head same-PR repair opt-ins into `local_review_fix` without rewriting the saved pre-merge outcome or creating residual follow-up issues.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `localReviewFollowUpRepairEnabled` was parsed but never used in PR state inference, so opted-in `follow_up_eligible` results kept flowing to `ready_to_merge`.
- What changed: Added `localReviewFollowUpNeedsRepair` in `src/review-handling.ts`, routed it to `local_review_fix` from `inferStateFromPullRequest`, and added focused tests in `src/pull-request-state-policy.test.ts` and `src/post-turn-pull-request.test.ts`.
- Current blocker: none.
- Next exact step: Commit the verified routing change on `codex/issue-1330`.
- Verification gap: none for the requested scope; named tests and build are passing.
- Files touched: `src/review-handling.ts`, `src/pull-request-state.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1330/issue-journal.md`.
- Rollback concern: Low; routing only changes current-head `follow_up_eligible` behavior when `localReviewFollowUpRepairEnabled` is explicitly enabled.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
