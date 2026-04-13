# Issue #1474: Bug: reply_only stale_review_bot incidents can stay permanently runnable after the first auto-reply

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1474
- Branch: codex/issue-1474
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3be9af5e5c8e3a5da236f1c61c23e7fffea72083
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-13T07:55:18.086Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale configured-bot recovery is selected too loosely; the supervisor re-enters `blocked/stale_review_bot` tracked PRs even after `reply_only` already handled the current PR head and stale-review signature.
- What changed: tightened `shouldAutoRecoverStaleReviewBot` to require an actionable current head/signature, and added focused tests for the suppressed same-head/same-signature recovery case plus explain output.
- Current blocker: none.
- Next exact step: commit this focused recovery-gate change, then optionally open/update a draft PR.
- Verification gap: full repo `npm test` still has unrelated pre-existing failures on this branch; focused issue verification passed on the requested stale-review-bot files.
- Files touched: `src/supervisor/supervisor-execution-policy.ts`, `src/supervisor/supervisor-execution-policy.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`.
- Rollback concern: low; the gate only suppresses stale-review auto-recovery when persisted state already proves the current head/signature received the stale-bot auto-reply.
- Last focused command: `node --test --import tsx src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
