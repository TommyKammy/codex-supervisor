# Issue #1190: Reconsider blocked no-PR stale-recovery issues when GitHub issue updates add new clarification

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1190
- Branch: codex/issue-1190
- Workspace: .
- Journal: .codex-supervisor/issues/1190/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7a21091d9f42a210d733d974e05c1b605cbd84ac
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-29T14:04:51.055Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileRecoverableBlockedIssueStates` should requeue blocked no-PR stale-loop manual stops when the GitHub issue `updatedAt` moves forward after the local manual stop timestamp.
- What changed: Added focused recovery tests for newer-vs-unchanged GitHub issue updates and implemented bounded requeue recovery for `blocked/manual_review` no-PR records with `last_failure_signature=stale-stabilizing-no-pr-recovery-loop`.
- Current blocker: none
- Next exact step: Commit the verified recovery/test change set and, if still no PR exists for `codex/issue-1190`, open a draft PR.
- Verification gap: No full `npm test` run yet; targeted recovery suite and `npm run build` passed.
- Files touched: `src/recovery-reconciliation.ts`; `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: Low; reconsideration is narrowly gated to no-PR stale-loop manual-review stops with a newer GitHub issue timestamp, and unchanged/manual-review tracked-PR paths are untouched.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
