# Issue #1347: Bug: classify degraded current-head local review separately from manual_review_required

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1347
- Branch: codex/issue-1347
- Workspace: .
- Journal: .codex-supervisor/issues/1347/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c7bd069b84b8803d9d381127c8542528cf34be46
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T08:11:20.530Z

## Latest Codex Summary
- Reproduced the tracked current-head regression where a degraded local-review run with no `manual_review_required` residuals still collapsed into `blocked/manual_review`.
- Fixed manual-review classification to require at least one true manual-review residual, leaving degraded no-manual-residual runs in the verification lane while preserving genuine manual-review blockers.
- Tightened pre-merge evaluation/status reporting so degraded artifacts surface as `degraded_local_review` instead of looking like unresolved manual-review residuals.
- Verified with focused tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The regression came from treating `manual_review_blocked` as synonymous with `manual_review_required`, even when the local-review artifact was degraded and `manualReviewCount` was zero.
- What changed: Updated review-handling and post-turn PR classification to require a real manual-review residual before mapping to `blocked/manual_review`; added regression coverage for the degraded current-head path; updated pre-merge evaluation reporting to emit `reason=degraded_local_review` and `repair=none` for degraded/no-manual-residual artifacts.
- Current blocker: none.
- Next exact step: Commit the fix on `codex/issue-1347` and leave the branch ready for PR/update.
- Verification gap: None in the focused issue scope; the requested targeted suite and build passed locally.
- Files touched: src/review-handling.ts, src/post-turn-pull-request.ts, src/supervisor/supervisor-pre-merge-evaluation.ts, src/post-turn-pull-request.test.ts, src/pull-request-state-policy.test.ts, src/supervisor/supervisor-pre-merge-evaluation.test.ts
- Rollback concern: Low. The behavior change is scoped to degraded local-review runs with zero manual-review residuals; genuine manual-review blockers still use `manual_review`.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
