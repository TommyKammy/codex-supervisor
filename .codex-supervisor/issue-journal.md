# Issue #994: Orphan cleanup decoupling: evaluate orphan pruning independently from done-workspace cleanup disables

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/994
- Branch: codex/issue-994
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1d75a2b7cb1a4dcb8acd4dba73b9412855dcb51f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T13:16:30.000Z

## Latest Codex Summary
- Added focused regression coverage proving orphan prune evaluation remains available when done-workspace cleanup is fully disabled, and build/test verification now passes in this worktree.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: after `#998` made orphan cleanup explicit operator work, the remaining risk for `#994` is a regression where disabled done-workspace cleanup settings might still be treated as a global "skip cleanup" gate for orphan evaluation paths.
- What changed: added `src/recovery-reconciliation.test.ts` with a focused temp-repo regression that first exercises `cleanupExpiredDoneWorkspaces()` under `cleanupDoneWorkspacesAfterHours=-1` and `maxDoneWorkspaces=-1`, then proves `inspectOrphanedWorkspacePruneCandidates()` still reports the orphan candidate and `pruneOrphanedWorkspacesForOperator()` still prunes it. Tightened `src/doctor.test.ts` to use the same disabled-done-cleanup config while still expecting orphan prune candidates in diagnostics.
- Current blocker: none.
- Next exact step: commit the focused regression-test patch on `codex/issue-994`, then push/open the issue branch if needed.
- Verification gap: none on the intended slice; `npx tsx --test src/recovery-reconciliation.test.ts src/doctor.test.ts` and `npm run build` are green after installing dev dependencies with `npm ci`.
- Files touched: `src/recovery-reconciliation.test.ts`, `src/doctor.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; this turn only adds regression coverage and does not alter runtime behavior.
- Last focused command: `npm run build`
- Exact failure reproduced: verified from current `main`/`#998` that runtime orphan cleanup is already explicit-only, so no implementation bug remained; the actionable gap for `#994` was missing regression coverage for the disabled done-cleanup configuration.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-994/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-994/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "cleanupOrphanedWorkspacesAfterHours|done-workspace|orphan|early return|cleanup" src/recovery-reconciliation.ts src/doctor.ts src/doctor.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '330,460p' src/recovery-reconciliation.ts`; `sed -n '604,652p' src/recovery-reconciliation.ts`; `sed -n '400,860p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1,220p' src/doctor.test.ts`; `gh issue view 993 --json number,title,body,state,url`; `gh issue view 994 --json number,title,body,state,url`; `gh pr view 998 --json number,title,body,state,headRefName,baseRefName,url`; `npx tsx --test src/recovery-reconciliation.test.ts src/doctor.test.ts`; `npm ci`; `npm run build`.
- PR status: none for `codex/issue-994` yet.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
