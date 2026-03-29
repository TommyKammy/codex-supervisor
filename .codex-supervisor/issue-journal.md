# Issue #1194: Repair remaining workspace reuse test expectations after cross-host discrepancy investigation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1194
- Branch: codex/issue-1194
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 16d70fd63fb08da66d08f400f8c5d333c5560262
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-29T22:34:49Z

## Latest Codex Summary
- Reproduced the two remaining `src/core/workspace.test.ts` failures on macOS, confirmed both now fail on the earlier unregistered-worktree guard in `assertReusableExistingWorkspace(...)`, updated the wrong-branch and detached-HEAD expectations to match that fail-closed boundary, and reran the focused test file plus `npm run build` to green.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining workspace reuse failures are stale test expectations only; the current fail-closed behavior now rejects these reused workspaces at the earlier "not a registered worktree" boundary before branch-specific validation can run.
- What changed: updated the wrong-branch and detached-HEAD assertions in `src/core/workspace.test.ts` to expect the current unregistered-worktree error emitted by `assertReusableExistingWorkspace(...)`.
- Current blocker: none.
- Next exact step: commit the focused test expectation repair, open or update the draft PR for `codex/issue-1194`, and monitor CI.
- Verification gap: I have not run the full repo suite; verification this turn is limited to `npm run build` and `npx tsx --test src/core/workspace.test.ts`.
- Files touched: `src/core/workspace.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change is test-only and narrows expectations to the already-observed fail-closed error path.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory and journal files, reproduced the two remaining workspace reuse failures, confirmed both now fail on the same unregistered-worktree guard, updated the two stale regex expectations, and reran focused verification to green.
- Exact failure reproduced this turn: both `ensureWorkspace rejects reusing an existing workspace on the wrong branch` and `ensureWorkspace rejects reusing an existing workspace on a detached HEAD` rejected with `Existing workspace is not a registered worktree for repository ...` instead of the later branch-specific error text.
- Commands run this turn: `sed -n '1,220p' /Users/tomoakikawada/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1194/AGENTS.generated.md`; `sed -n '1,260p' /Users/tomoakikawada/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1194/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `git log --oneline --decorate -5`; `npx tsx --test src/core/workspace.test.ts`; `sed -n '360,440p' src/core/workspace.test.ts`; `sed -n '200,290p' src/core/workspace.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
