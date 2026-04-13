# Issue #1476: Bug: reply_and_resolve can resolve stale configured-bot threads but leave tracked PR blocked as stale_review_bot

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1476
- Branch: codex/issue-1476
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 1eeba93624afb2f8c5c476fc9fc88087b5e3da21
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856etYm|PRRT_kwDORgvdZ856etY6
- Repeated failure signature count: 1
- Updated at: 2026-04-13T09:21:48.563Z

## Latest Codex Summary
Implemented the fix in `src/post-turn-pull-request.ts` and committed it as `1eeba93` (`Refresh tracked PR state after stale bot auto-resolve`).

The change does two things. First, it adds a focused regression in `src/post-turn-pull-request.test.ts` that reproduces the stale same-head `reply_and_resolve` case: unresolved configured-bot threads are auto-resolved, a fresh same-head snapshot clears them, and the tracked record must stop reporting `blocked_reason=stale_review_bot`. Second, it reuses the tracked PR lifecycle projection after successful same-head `reply_and_resolve`, so the supervisor refreshes GitHub facts, updates the persisted tracked state, and re-runs sticky status comment handling against the refreshed snapshot instead of returning the stale blocked record.

Verification passed with:
`node --test --import tsx src/post-turn-pull-request.test.ts --test-name-pattern "refreshes tracked PR state after reply_and_resolve clears stale configured-bot threads"`
`node --test --import tsx src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`
`npm run build`

Summary: Reproduced and fixed same-head `reply_and_resolve` stale-review convergence so tracked PR state refreshes out of `stale_review_bot` after auto-resolution, with regression coverage added.
State hint: stabilizing
Blocked reason: none
Tests: Focused post-turn reproducer; requested 5-file node test suite; `npm run build`
Next action: Push `codex/issue-1476` and open or update the draft PR if needed.
Failure signature: PRRT_kwDORgvdZ856etYm|PRRT_kwDORgvdZ856etY6

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1477#discussion_r3071996214
- Details:
  - src/post-turn-pull-request.ts:1719 summary=_⚠️ Potential issue_ | _🟡 Minor_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 1047 --- 🏁 Script executed: Repository: TommyK... url=https://github.com/TommyKammy/codex-supervisor/pull/1477#discussion_r3071996214
  - src/post-turn-pull-request.ts:1718 summary=_⚠️ Potential issue_ | _🟠 Major_ **Always propagate the reconciled snapshot after the extra load.** `applyTrackedPrLifecycleState()` has already persisted `reconciledRecord`, b... url=https://github.com/TommyKammy/codex-supervisor/pull/1477#discussion_r3071996239

## Codex Working Notes
### Current Handoff
- Hypothesis: the review feedback was correct on two points: the exported handler args still omitted `github.resolveReviewThread`, and the same-head `reply_and_resolve` refresh path only propagated `postReady` and `record` when the stale-review blocker cleared, so callers could observe a pre-refresh record even after `applyTrackedPrLifecycleState()` persisted newer blocked-state facts.
- What changed: added `resolveReviewThread` to `HandlePostTurnPullRequestTransitionsArgs["github"]`; updated the same-head `shouldRefreshAfterReplyAndResolve` branch in `src/post-turn-pull-request.ts` to always assign the reconciled snapshot and refreshed record before conditionally re-running persistent-status commenting; added a regression in `src/post-turn-pull-request.test.ts` that keeps the PR blocked on a different stale configured-bot thread after refresh and asserts the returned record and review-thread snapshot match the reconciled state.
- Current blocker: none.
- Next exact step: commit the review-thread fixes on `codex/issue-1476` and update PR #1477.
- Verification gap: none for the requested local scope; targeted suite and build are green.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`.
- Rollback concern: low to moderate; the reconciled snapshot is now always returned for same-head `reply_and_resolve` refreshes, so future edits in this area should avoid coupling return-value freshness to whether the blocker clears.
- Last focused command: `node --test --import tsx src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`
### Scratchpad
- Reproducer command: `node --test --import tsx src/post-turn-pull-request.test.ts --test-name-pattern "refreshes tracked PR state after reply_and_resolve clears stale configured-bot threads"`
- Targeted verification: `node --test --import tsx src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`
- Review-fix verification: `node --test --import tsx src/post-turn-pull-request.test.ts --test-name-pattern "reply_and_resolve"` and `npm run build`
- Keep this section short. The supervisor may compact older notes automatically.
