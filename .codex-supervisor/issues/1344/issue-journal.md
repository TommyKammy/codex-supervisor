# Issue #1344: Enhancement: opt-in same-PR auto-repair for current-head manual_review_blocked local-review residuals

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1344
- Branch: codex/issue-1344
- Workspace: .
- Journal: .codex-supervisor/issues/1344/issue-journal.md
- Current phase: local_review_fix
- Attempt count: 10 (implementation=2, repair=1)
- Last head SHA: 23fd198f202dd233b44d925ddda2d7a04a897d15
- Blocked reason: none
- Last failure signature: local-review:medium:none:2:0:clean
- Repeated failure signature count: 2
- Updated at: 2026-04-08T04:54:57.938Z

## Latest Codex Summary
Split same-PR local-review repair into two explicit opt-ins so `manual_review_blocked` no longer rides on `localReviewFollowUpRepairEnabled`. The new `localReviewManualReviewRepairEnabled` flag defaults to `false`, and the manual-review repair lane now checks that flag in [review-handling.ts](src/review-handling.ts), [supervisor-pre-merge-evaluation.ts](src/supervisor/supervisor-pre-merge-evaluation.ts), and [turn-execution-orchestration.ts](src/turn-execution-orchestration.ts).

Adjusted [post-turn-pull-request.ts](src/post-turn-pull-request.ts) so same-head local-review retry counters reset whenever the retry lane is inactive after a post-ready refresh, which prevents stale counts from prematurely tripping the repeat limit when manual-review auto-repair temporarily exits and later becomes eligible again. Added focused regressions in [config.test.ts](src/config.test.ts), [review-handling.test.ts](src/review-handling.test.ts), [pull-request-state-policy.test.ts](src/pull-request-state-policy.test.ts), [post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts), and [supervisor-pre-merge-evaluation.test.ts](src/supervisor/supervisor-pre-merge-evaluation.test.ts).

Summary: Added a fail-closed manual-review same-PR repair opt-in and reset stale same-head retry counters when the lane exits
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/config.test.ts`; `npm run build`
Next action: Commit and push this repair checkpoint, then recheck PR #1345 for any remaining local-review findings or CI drift
Failure signature: none

## Active Failure Context
- Category: blocked
- Summary: Local review found 2 actionable finding(s) across 2 root cause(s); max severity=medium; verified high-severity findings=0; verified max severity=none.
- Details:
  - findings=2
  - root_causes=2
  - summary=<redacted-local-path>

## Codex Working Notes
### Current Handoff
- Hypothesis: `manual_review_blocked` same-PR repair must be guarded by its own explicit opt-in and must drop any same-head repeat count whenever the repair lane is not currently eligible, otherwise existing follow-up opt-ins broaden behavior and stale counters can force premature blocking.
- What changed: Added `localReviewManualReviewRepairEnabled` with a fail-closed default in `src/core/types.ts` and `src/core/config.ts`, then rewired the manual-review same-PR lane in `src/review-handling.ts`, `src/supervisor/supervisor-pre-merge-evaluation.ts`, and `src/turn-execution-orchestration.ts` to use that new flag instead of `localReviewFollowUpRepairEnabled`. Updated `src/post-turn-pull-request.ts` so repeated local-review signatures reset to `0` whenever the current-head retry lane is inactive after the post-ready refresh. Added focused regressions in `src/config.test.ts`, `src/review-handling.test.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`, and `src/supervisor/supervisor-pre-merge-evaluation.test.ts`.
- Current blocker: none
- Next exact step: Commit and push this repair checkpoint, then recheck PR #1345 on the new head for any remaining local-review findings, review-thread follow-up, or CI drift.
- Verification gap: None for this checkpoint after `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/config.test.ts` and `npm run build`.
- Files touched: src/core/types.ts; src/core/config.ts; src/review-handling.ts; src/supervisor/supervisor-pre-merge-evaluation.ts; src/turn-execution-orchestration.ts; src/post-turn-pull-request.ts; src/config.test.ts; src/review-handling.test.ts; src/pull-request-state-policy.test.ts; src/post-turn-pull-request.test.ts; src/supervisor/supervisor-pre-merge-evaluation.test.ts
- Rollback concern: Low. The behavior change is fail-closed by default and the repeat-counter reset only applies when the current-head retry lane is inactive after a post-ready refresh.
- Last focused command: `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/config.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
