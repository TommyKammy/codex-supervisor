# Issue #996: Orphan cleanup runtime alignment: make default pruning behavior match the intended operator policy

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/996
- Branch: codex/issue-996
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2fba051b929b22813fe2f033c8f14ba9e5df6a0c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T14:09:52Z

## Latest Codex Summary
- Added a focused reconciliation-level regression test proving runtime done-workspace cleanup preserves orphaned `issue-*` workspaces until the explicit `prune-orphaned-workspaces` operator path is invoked, verified the requested focused tests plus `npm run build`, committed the checkpoint as `01a955777a398ea8b34690747762cdee2cbf4008`, pushed `codex/issue-996`, and opened draft PR `#1017`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the runtime/operator-policy alignment is already implemented on `main`, but the narrow proof lived in broader supervisor cleanup tests rather than the requested reconciliation-focused verification surface.
- What changed: added a focused regression in `src/recovery-reconciliation.test.ts` that exercises `cleanupExpiredDoneWorkspaces()` against an orphaned `issue-*` worktree, verifies the runtime path leaves it intact, and then verifies `pruneOrphanedWorkspacesForOperator()` removes the same orphan explicitly.
- Current blocker: none.
- Next exact step: monitor draft PR `#1017` for review or CI signal; if none appears, the branch is ready for local review because the runtime-policy regression is now covered directly in the requested test surface.
- Verification gap: none locally after installing locked dependencies with `npm ci`; focused tests and `npm run build` both passed.
- Files touched: `src/recovery-reconciliation.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; only test coverage and journal state changed.
- Last focused command: `npx tsx --test src/recovery-reconciliation.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts`
- Exact failure reproduced: not a live code failure on current `main`; the issue was reproduced as a coverage gap, with runtime/orphan policy only indirectly protected by broader supervisor tests before adding the new reconciliation-level regression.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-996/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-996/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "orphan|prun" src`; `rg --files src | rg "recovery-reconciliation|supervisor-runtime|doctor|orphan|cleanup|prune"`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `sed -n '260,520p' src/recovery-reconciliation.ts`; `sed -n '1,260p' src/recovery-reconciliation.test.ts`; `sed -n '700,860p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1360,1425p' src/supervisor/supervisor.ts`; `sed -n '1,240p' src/run-once-cycle-prelude.ts`; `sed -n '1,220p' src/config.test.ts`; `rg -n "cleanupOrphanedWorkspacesAfterHours|cleanupDoneWorkspacesAfterHours|maxDoneWorkspaces" src`; `sed -n '1,260p' src/core/types.ts`; `rg -n "background.*prune|orphan.*mode|prune mode|operator-explicit|orphan cleanup" src docs README.md`; `sed -n '110,155p' docs/configuration.md`; `git log --oneline --decorate -n 12 -- src/recovery-reconciliation.ts src/core/config.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `git show --stat --summary 1d75a2b`; `git show 1d75a2b -- src/recovery-reconciliation.ts src/supervisor/supervisor-execution-cleanup.test.ts src/core/config.ts docs/configuration.md README.md docs/getting-started.md docs/architecture.md`; `npx tsx --test src/recovery-reconciliation.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts`; `npm run build`; `cat package.json`; `test -d node_modules && echo present || echo missing`; `test -f package-lock.json && echo lock-present || echo lock-missing`; `npm ci`; `npm run build`; `npx tsx --test src/recovery-reconciliation.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts`; `git diff -- src/recovery-reconciliation.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git status --short --branch`; `git add .codex-supervisor/issue-journal.md src/recovery-reconciliation.test.ts`; `git commit -m "Add orphan cleanup runtime regression test"`; `git rev-parse HEAD`; `gh pr view --json number,url,isDraft,headRefName,baseRefName`; `git push -u origin codex/issue-996`; `gh pr create --draft --base main --head codex/issue-996 --title "Issue #996: Add orphan cleanup runtime regression coverage" --body <redacted>`
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1017` on head `01a955777a398ea8b34690747762cdee2cbf4008`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
