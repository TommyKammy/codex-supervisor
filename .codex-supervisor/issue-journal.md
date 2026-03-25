# Issue #1010: Done-workspace cleanup observability: preserve recovery events for tracked background cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1010
- Branch: codex/issue-1010
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 4 (implementation=4, repair=0)
- Last head SHA: e897abe850e1faa1fdbd9ef09ad0ca01e7b172c4
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-25T17:44:06Z

## Latest Codex Summary
Published branch `codex/issue-1010` and opened draft PR [#1028](https://github.com/TommyKammy/codex-supervisor/pull/1028) from the verified checkpoint headed by `e897abe` (`Align cleanup tests with runOnce orchestration`).

The implementation and focused verification from the prior checkpoint remain unchanged: `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts` and `npm run build` both passed before opening the PR. The worktree still has untracked local supervisor artifacts under `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/`, which I left untouched.

Summary: Opened draft PR `#1028` from the verified issue-1010 checkpoint and refreshed the issue journal for PR handoff
State hint: draft_pr
Blocked reason: none
Tests: not rerun this turn; prior checkpoint verification still stands with `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts` and `npm run build`
Next action: monitor PR `#1028` and address CI or review feedback if any appears
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `cleanupExpiredDoneWorkspaces()` still performed tracked done-workspace deletion, but it dropped those cleanups on the floor by returning `[]`, so `runOnceCyclePrelude()` and `runOnce()` had nothing operator-visible to surface.
- What changed: added a focused direct regression for `cleanupExpiredDoneWorkspaces()` recovery-event emission, tightened the existing `runOnce` cleanup regression to require the recovery log in the returned message, and updated `cleanupExpiredDoneWorkspaces()` to return `done_workspace_cleanup` recovery events whenever a tracked done workspace is actually cleaned.
- Current blocker: none locally; draft PR `#1028` is open and the verified implementation checkpoint is published.
- Next exact step: watch PR `#1028` for CI or review feedback and respond if needed.
- Verification gap: none for the requested local commands; this turn did not change implementation files.
- Files touched: `src/recovery-reconciliation.ts`; `src/recovery-reconciliation.test.ts`; `src/supervisor/supervisor-execution-cleanup.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; runtime behavior only changes recovery-event reporting for tracked done-workspace cleanup, and the new tests pin the intended operator-visible output.
- Last focused command: `npm run build`
- Exact failure reproduced: before this checkpoint `cleanupExpiredDoneWorkspaces()` removed tracked done workspaces but returned no recovery events, and `runOnce({ dryRun: true })` therefore returned only `No matching open issue found.` instead of a prefixed recovery log for the cleanup.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '852,980p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1172,1288p' src/supervisor/supervisor-execution-cleanup.test.ts`; `rg -n "restart|merged PR|tracked PR already merged|merging" src/supervisor/supervisor.ts src/supervisor -g '!dist'`; `sed -n '480,560p' src/supervisor/supervisor.ts`; `sed -n '1400,1505p' src/supervisor/supervisor.ts`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `sed -n '1,320p' src/run-once-issue-selection.ts`; `sed -n '320,620p' src/run-once-issue-selection.ts`; `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts`; `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git log --oneline --decorate -5`; `gh pr status`; `git diff -- .codex-supervisor/issue-journal.md`; `git diff --stat origin/main...HEAD`; `git branch -vv`; `git push -u origin codex/issue-1010`; `gh pr create --draft --base main --head codex/issue-1010 --title "Issue #1010: preserve recovery events for tracked done-workspace cleanup" ...`; `gh pr view 1028 --json number,url,state,isDraft,headRefName,baseRefName`.
- PR status: draft PR `#1028` is open at `https://github.com/TommyKammy/codex-supervisor/pull/1028`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
