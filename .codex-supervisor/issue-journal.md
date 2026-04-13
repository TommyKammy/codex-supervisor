# Issue #1472: Bug: blocked stale_review_bot tracked PRs are never revisited after enabling reply_and_resolve

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1472
- Branch: codex/issue-1472
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 19f21f8eb46774e52e72fee7ff019bcc6419b492
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-13T06:56:25.806Z

## Latest Codex Summary
- Added a stale-review-bot auto-recovery gate so tracked PR records already blocked as `stale_review_bot` become selectable and recoverable again when `staleConfiguredBotReviewPolicy` is `reply_only` or `reply_and_resolve`.
- Extended supervisor-side coverage for selection eligibility, blocked-state reconciliation, and explain diagnostics to prove the issue reproduces and is fixed without broadening `diagnose_only`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the stale configured-bot reply/resolve handler already works in `post-turn`, but supervisor selection/recovery treated `blocked_reason=stale_review_bot` as a permanent manual block, so already-blocked tracked PR incidents never re-entered that handler after the policy changed.
- What changed: added `shouldAutoRecoverStaleReviewBot()` in supervisor execution policy, used it in selection eligibility and explain retry-state/manual-block reasoning, and allowed tracked-PR blocked-state reconciliation to revisit `stale_review_bot` records when the policy is `reply_only` or `reply_and_resolve`.
- Current blocker: none.
- Next exact step: commit the focused change set and proceed to PR/update flow if requested by the supervisor loop.
- Verification gap: full `npm test -- <file>` still pulls unrelated suite-wide failures in this repo, so focused verification used `npx tsx --test` with the exact requested files instead.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-execution-policy.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-policy.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Rollback concern: low; the new recovery path is limited to tracked PR records already blocked as `stale_review_bot` and still defers actual reply/resolve safety checks to the existing post-turn stale-bot handler.
- Last focused command: `npx tsx --test src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
