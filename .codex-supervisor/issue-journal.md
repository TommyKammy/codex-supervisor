# Issue #1010: Done-workspace cleanup observability: preserve recovery events for tracked background cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1010
- Branch: codex/issue-1010
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c6fd74802cab6c8bdbd79af8efcba9c999d8fe5b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T17:29:25.131Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `cleanupExpiredDoneWorkspaces()` still performed tracked done-workspace deletion, but it dropped those cleanups on the floor by returning `[]`, so `runOnceCyclePrelude()` and `runOnce()` had nothing operator-visible to surface.
- What changed: added a focused direct regression for `cleanupExpiredDoneWorkspaces()` recovery-event emission, tightened the existing `runOnce` cleanup regression to require the recovery log in the returned message, and updated `cleanupExpiredDoneWorkspaces()` to return `done_workspace_cleanup` recovery events whenever a tracked done workspace is actually cleaned.
- Current blocker: the requested file-level test command still has two unrelated pre-existing failures in `src/supervisor/supervisor-execution-cleanup.test.ts` (`runOnce releases the current issue lock before restarting after a merged PR`, `runOnce reconciles inactive merging records whose tracked PR already merged`).
- Next exact step: decide whether to repair those unrelated red tests on this branch so the full requested verification command can pass, then commit the issue #1010 cleanup-observability checkpoint.
- Verification gap: issue-specific regressions pass and `npm run build` passes after `npm ci`, but `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts` still fails because of the two unrelated cleanup-test regressions above.
- Files touched: `src/recovery-reconciliation.ts`; `src/recovery-reconciliation.test.ts`; `src/supervisor/supervisor-execution-cleanup.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; runtime behavior only changes recovery-event reporting for tracked done-workspace cleanup, and the new tests pin the intended operator-visible output.
- Last focused command: `npm run build`
- Exact failure reproduced: before this checkpoint `cleanupExpiredDoneWorkspaces()` removed tracked done workspaces but returned no recovery events, and `runOnce({ dryRun: true })` therefore returned only `No matching open issue found.` instead of a prefixed recovery log for the cleanup.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1010/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1010/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "cleanupExpiredDoneWorkspaces|done workspace|recovery event|recoveryEvents|orphan-prune|tracked done-workspace|cleanupExpired" src -g '!dist'`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `sed -n '1,260p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1240,1475p' src/recovery-reconciliation.ts`; `sed -n '1,240p' src/recovery-reconciliation.test.ts`; `rg -n "cleanupExpiredDoneWorkspaces|done workspace|recoveryEvents|formatRecoveryLog|prependRecoveryLog" src/supervisor/supervisor-execution-cleanup.test.ts src/recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor.ts -g '!dist'`; `sed -n '430,620p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1,220p' src/run-once-cycle-prelude.ts`; `sed -n '640,780p' src/recovery-reconciliation.ts`; `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `rg -n "function buildRecoveryEvent|const recoveryEvent = buildRecoveryEvent|formatRecoveryLog|prependRecoveryLog|applyRecoveryEvent" src/recovery-reconciliation.ts src/supervisor/supervisor.ts src -g '!dist'`; `sed -n '487,525p' src/recovery-reconciliation.ts`; `git diff -- src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `npx tsx --test --test-name-pattern "cleanupExpiredDoneWorkspaces returns recovery events for tracked done workspace deletions|runOnce still cleans tracked done workspaces under the done-workspace policy" src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `rg -n "cleanupRecordWorkspace\\(" src/recovery-reconciliation.ts src -g '!dist'`; `sed -n '1,220p' src/core/workspace.ts`; `git diff -- src/recovery-reconciliation.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `npm run build`; `test -d node_modules && echo present || echo missing`; `npm ci`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: no issue-specific PR update yet in this turn.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
