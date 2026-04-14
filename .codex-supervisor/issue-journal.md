# Issue #1524: Bug: tracked PR stale_review_bot blockers should auto-clear when GitHub threads are already resolved

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1524
- Branch: codex/issue-1524
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 3 (implementation=3, repair=0)
- Last head SHA: 6154a5e6dac2c30fee62f3899fa5c7713440175b
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-04-14T11:04:57.377Z

## Latest Codex Summary
- Tracked PR stale `stale_review_bot` reconciliation now ignores the auto-reply policy gate and always reprojects same-head tracked PR blockers from fresh GitHub facts; focused regressions and build passed locally, commit `13520d4` is pushed on `codex/issue-1524`, and draft PR #1525 is open.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `stale_review_bot` was incorrectly treated as auto-recovery-policy-gated durable state; convergence should instead always reproject tracked PR blockers from fresh GitHub facts, even under `diagnose_only`.
- What changed: refactored `src/supervisor/supervisor-execution-policy.ts` so `shouldAutoRecoverStaleReviewBot` stays policy-gated but `shouldReconcileTrackedPrStaleReviewBot` now only checks whether the record is a tracked `stale_review_bot` block; added regressions covering recovery, runOnce, explain, and doctor behavior under `diagnose_only`.
- Current blocker: none.
- Next exact step: wait for review on draft PR #1525 and address any feedback or CI findings.
- Verification gap: none for the requested scope; targeted suites and `npm run build` passed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-execution-policy.ts`, `src/supervisor/supervisor-execution-policy.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-pr-review-blockers.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/doctor.test.ts`.
- Rollback concern: low; the behavior change is intentionally limited to stale tracked-PR blocker reprojection, while automatic stale-bot reply handling still depends on the configured policy.
- Last focused commands: `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `git push -u origin codex/issue-1524`; `gh pr edit 1525 --body ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
