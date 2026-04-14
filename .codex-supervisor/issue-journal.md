# Issue #1524: Bug: tracked PR stale_review_bot blockers should auto-clear when GitHub threads are already resolved

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1524
- Branch: codex/issue-1524
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 4 (implementation=3, repair=1)
- Last head SHA: fed7a48657e0ad13f65c53bfea9cf316edbf76c7
- Blocked reason: none
- Last failure signature: dirty:fed7a48657e0ad13f65c53bfea9cf316edbf76c7
- Repeated failure signature count: 3
- Updated at: 2026-04-14T11:10:21.067Z

## Latest Codex Summary
The tracked-PR reconciliation path now clears stale `stale_review_bot` blockers from fresh GitHub facts even when `staleConfiguredBotReviewPolicy=diagnose_only`, while the automatic reply/resolve path remains policy-gated in [src/supervisor/supervisor-execution-policy.ts](src/supervisor/supervisor-execution-policy.ts). I added focused regressions for reconciliation, `runOnce`, `explain`, and `doctor` in [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts), [src/supervisor/supervisor-pr-review-blockers.test.ts](src/supervisor/supervisor-pr-review-blockers.test.ts), [src/supervisor/supervisor-diagnostics-explain.test.ts](src/supervisor/supervisor-diagnostics-explain.test.ts), and [src/doctor.test.ts](src/doctor.test.ts).

I committed and pushed the checkpoint on `codex/issue-1524`, updated the issue journal, and opened draft PR `#1525`: https://github.com/TommyKammy/codex-supervisor/pull/1525. The only remaining local changes are untracked supervisor artifact directories under `.codex-supervisor/`, which I left out of git.

Summary: Implemented and verified stale tracked-PR `stale_review_bot` auto-clear reconciliation, pushed branch, and opened draft PR #1525.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
Next action: Wait for review and CI on draft PR #1525, then address any findings.
Failure signature: dirty:fed7a48657e0ad13f65c53bfea9cf316edbf76c7

## Active Failure Context
- Category: conflict
- Summary: PR #1525 has merge conflicts and needs a base-branch integration pass.
- Command or source: git fetch origin && git merge origin/<default-branch>
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1525
- Details:
  - mergeStateStatus=DIRTY

## Codex Working Notes
### Current Handoff
- Hypothesis: `stale_review_bot` was incorrectly treated as auto-recovery-policy-gated durable state; convergence should instead always reproject tracked PR blockers from fresh GitHub facts, even under `diagnose_only`.
- What changed: refactored `src/supervisor/supervisor-execution-policy.ts` so `shouldAutoRecoverStaleReviewBot` stays policy-gated but `shouldReconcileTrackedPrStaleReviewBot` now only checks whether the record is a tracked `stale_review_bot` block; added regressions covering recovery, runOnce, explain, and doctor behavior under `diagnose_only`.
- Current blocker: none.
- Next exact step: wait for review on draft PR #1525 and address any feedback or CI findings.
- Verification gap: none for the requested scope; targeted suites and `npm run build` passed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-execution-policy.ts`, `src/supervisor/supervisor-execution-policy.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-pr-review-blockers.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/doctor.test.ts`.
- Rollback concern: low; the behavior change is intentionally limited to stale tracked-PR blocker reprojection, while automatic stale-bot reply handling still depends on the configured policy.
- Last focused command:
- Last focused commands: `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `git push -u origin codex/issue-1524`; `gh pr edit 1525 --body ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
