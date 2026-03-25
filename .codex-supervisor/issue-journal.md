# Issue #993: Orphan cleanup contract: define explicit operator vs background cleanup semantics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/993
- Branch: codex/issue-993
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 15d8af3f10d9c810965381072957b6e3ae9d91d8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T13:38:00.000Z

## Latest Codex Summary
- Reproduced the contract mismatch with a focused cleanup regression: `runOnce({ dryRun: true })` was still pruning an orphaned `issue-*` worktree in the background and returning `recovery issue=#92 reason=pruned orphaned worktree issue-92; No matching open issue found.` even though the docs already described orphan pruning as an explicit operator action.
- Removed background orphan pruning from `cleanupExpiredDoneWorkspaces()`, kept tracked done-workspace cleanup in `runOnce`, and tightened cleanup/docs tests plus the workspace-cleanup docs so `cleanupOrphanedWorkspacesAfterHours` is clearly an explicit-prune/doctor eligibility gate rather than a background cleanup switch.
- Local verification passed for `npx tsx --test src/execution-safety-docs.test.ts` and `npm run build` after restoring missing dev dependencies with `npm install`; the broader `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts` run still has two unrelated pre-existing failures in merged-PR reconciliation coverage.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: orphan cleanup should be explicit operator work only, while `runOnce` should keep handling tracked done-workspace cleanup; the runtime mismatch was that `cleanupExpiredDoneWorkspaces()` still piggybacked orphan pruning onto the background reconciliation path.
- What changed: removed the background orphan-prune call from `cleanupExpiredDoneWorkspaces()`, added a focused regression proving `runOnce` preserves orphaned worktrees until `pruneOrphanedWorkspaces()` is invoked explicitly, added a positive test that tracked done-workspace cleanup still runs under the done-workspace policy, moved the lock/unreadable-root orphan assertions onto the explicit prune command, and tightened the docs plus `src/execution-safety-docs.test.ts` so config/docs no longer describe orphan pruning as automatic.
- Current blocker: none.
- Next exact step: review PR #998 feedback and decide whether the unrelated merged-PR reconciliation test failures belong in a separate follow-up or need immediate investigation before merge.
- Verification gap: `npm run build` and the focused cleanup/docs assertions are green, but `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts` still reports two failures outside this issue’s slice (`runOnce releases the current issue lock before restarting after a merged PR` and `runOnce reconciles inactive merging records whose tracked PR already merged`).
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `src/execution-safety-docs.test.ts`, `docs/configuration.md`, `docs/getting-started.md`, `docs/architecture.md`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the runtime change only stops background orphan pruning from happening during `runOnce`, while the explicit `prune-orphaned-workspaces` path and tracked done-workspace cleanup remain intact.
- Last focused command: `npm run build`
- Exact failure reproduced: the focused regression changed `runOnce` to expect `"No matching open issue found."` while preserving an orphaned `issue-92` worktree, but the pre-fix runtime returned `recovery issue=#92 reason=pruned orphaned worktree issue-92; No matching open issue found.` and deleted the orphan branch/worktree as a background side effect.
- Commands run: `rg -n "orphan|done-workspace|cleanup" src docs README.md docs/getting-started.md`; `sed -n '380,780p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '340,760p' src/recovery-reconciliation.ts`; `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts --test-name-pattern "runOnce preserves orphaned done worktrees that are no longer referenced by state until an operator prune"`; `npm install`; `npx tsx --test src/execution-safety-docs.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts`; `npm run build`; `git push -u origin codex/issue-993`; `gh pr create --draft --base main --head codex/issue-993 --title "Define explicit orphan cleanup contract" ...`.
- PR status: draft PR opened at `https://github.com/TommyKammy/codex-supervisor/pull/998`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
