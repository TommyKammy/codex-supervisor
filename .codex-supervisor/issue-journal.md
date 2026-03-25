# Issue #994: Orphan cleanup decoupling: evaluate orphan pruning independently from done-workspace cleanup disables

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/994
- Branch: codex/issue-994
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 0953237f3b12bd5124ca00cf39aea04ff4fcb360
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T13:25:30.000Z

## Latest Codex Summary
Pushed `codex/issue-994` to origin and opened draft PR [#1012](https://github.com/TommyKammy/codex-supervisor/pull/1012) for the focused regression-test slice. The branch still only adds test coverage for disabled done-cleanup settings; no runtime behavior changed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: after `#998` made orphan cleanup explicit operator work, the remaining risk for `#994` is a regression where disabled done-workspace cleanup settings might still be treated as a global "skip cleanup" gate for orphan evaluation paths.
- What changed: added `src/recovery-reconciliation.test.ts` with a focused temp-repo regression that first exercises `cleanupExpiredDoneWorkspaces()` under `cleanupDoneWorkspacesAfterHours=-1` and `maxDoneWorkspaces=-1`, then proves `inspectOrphanedWorkspacePruneCandidates()` still reports the orphan candidate and `pruneOrphanedWorkspacesForOperator()` still prunes it. Tightened `src/doctor.test.ts` to use the same disabled-done-cleanup config while still expecting orphan prune candidates in diagnostics.
- Current blocker: none.
- Next exact step: wait for review/CI on PR #1012, then address any feedback if it appears.
- Verification gap: none on the intended slice; `npx tsx --test src/recovery-reconciliation.test.ts src/doctor.test.ts` and `npm run build` are green after installing dev dependencies with `npm ci`.
- Files touched: `src/recovery-reconciliation.test.ts`, `src/doctor.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; this turn only adds regression coverage and does not alter runtime behavior.
- Last focused command: `gh pr create --draft --base main --head codex/issue-994 --title "Add orphan cleanup disable regression coverage" ...`
- Exact failure reproduced: verified from current `main`/`#998` that runtime orphan cleanup is already explicit-only, so no implementation bug remained; the actionable gap for `#994` was missing regression coverage for the disabled done-cleanup configuration.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "cleanupOrphanedWorkspacesAfterHours|done-workspace|orphan|early return|cleanup" src/recovery-reconciliation.ts src/doctor.ts src/doctor.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '330,460p' src/recovery-reconciliation.ts`; `sed -n '604,652p' src/recovery-reconciliation.ts`; `sed -n '400,860p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1,220p' src/doctor.test.ts`; `gh issue view 993 --json number,title,body,state,url`; `gh issue view 994 --json number,title,body,state,url`; `gh pr view 998 --json number,title,body,state,headRefName,baseRefName,url`; `npx tsx --test src/recovery-reconciliation.test.ts src/doctor.test.ts`; `npm ci`; `npm run build`; `git push -u origin codex/issue-994`; `gh pr create --draft --base main --head codex/issue-994 --title "Add orphan cleanup disable regression coverage" ...`; `gh pr view 1012 --json number,state,url,isDraft,headRefName,baseRefName,title`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1012`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
