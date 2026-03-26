# Issue #1048: Converge parent epic closure when full inventory refresh is degraded

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1048
- Branch: codex/issue-1048
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f340980aaac2a2d0ed1ed4608443506ea6ace38c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T06:17:40.081Z

## Latest Codex Summary
- Added a focused `runOnceCyclePrelude` regression that proves degraded full-inventory refresh still reconciles parent-epic closure from tracked issue snapshots while preserving `inventory_refresh_failure`, then implemented the narrow tracked-issue fallback and verified the affected prelude, reconciliation, and diagnostics tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: parent-epic closure is blocked specifically by the early degraded-inventory return in `runOnceCyclePrelude`; fetching tracked issue snapshots with `getIssue()` is narrow enough to evaluate already-known parent/child closure safely without reopening broad issue selection.
- What changed: added a focused degraded-inventory regression in `src/run-once-cycle-prelude.test.ts`; updated `src/run-once-cycle-prelude.ts` to fetch tracked issue snapshots for `reconcileParentEpicClosures` when `listAllIssues()` fails; wired the fallback through `src/supervisor/supervisor.ts`.
- Current blocker: none locally.
- Next exact step: review the final diff and commit the degraded parent-epic closure fallback checkpoint on `codex/issue-1048`.
- Verification gap: none in the requested local scope after rerunning the degraded inventory diagnostics suites.
- Files touched: `src/run-once-cycle-prelude.test.ts`, `src/run-once-cycle-prelude.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: medium-low; the fallback intentionally limits degraded-mode reconciliation to already-tracked issue records, but widening the tracked record set too far in future changes could make degraded reconciliation slower.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`
- Exact failure reproduced: when `listAllIssues()` failed, `runOnceCyclePrelude` persisted `inventory_refresh_failure` and returned before `reconcileParentEpicClosures`, so an open epic with already-closed tracked children stayed open until manual intervention.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1048/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1048/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "epic|parent epic|inventory refresh|full inventory|degraded|child issues" src test . -g '!node_modules'`; `rg --files src test | rg "test|spec"`; `sed -n '1180,1315p' src/recovery-reconciliation.ts`; `sed -n '1660,1785p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `rg -n "Closed automatically because all child issues are closed|parent epic|epic closure|inventory_refresh" src/supervisor/supervisor-recovery-reconciliation.test.ts src/recovery-reconciliation.test.ts`; `rg -n "findParentIssuesReadyToClose|reconcileParentEpicClosures|parentIssuesReadyToClose" src`; `sed -n '1,260p' src/recovery-reconciliation.test.ts`; `sed -n '260,520p' src/recovery-reconciliation.test.ts`; `sed -n '760,950p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '950,1035p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '1,220p' src/run-once-cycle-prelude.ts`; `sed -n '1,260p' src/issue-metadata/issue-metadata.ts`; `sed -n '1,260p' src/core/types.ts`; `rg -n "listAllIssues\\(|listCandidateIssues\\(|getIssue\\(|Part of|parentIssueNumber|childIssues" src`; `sed -n '1,220p' src/github/github.ts`; `sed -n '220,360p' src/github/github.ts`; `sed -n '1,260p' src/supervisor/supervisor.ts`; `sed -n '430,540p' src/run-once-cycle-prelude.test.ts`; `sed -n '540,680p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,160p' src/run-once-cycle-prelude.test.ts`; `rg -n "runOnceCyclePrelude\\(" -n src/supervisor/supervisor.ts src/**/*.ts`; `sed -n '1400,1475p' src/supervisor/supervisor.ts`; `rg -n "inventory_refresh_failure|formatInventoryRefreshStatusLine|Full inventory refresh is degraded" src/supervisor`; `apply_patch` to add the focused degraded-inventory regression; `apply_patch` to add tracked-issue parent-epic fallback loading in `runOnceCyclePrelude`; `apply_patch` to wire the fallback through `Supervisor`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `git diff -- src/run-once-cycle-prelude.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor.ts .codex-supervisor/issue-journal.md`; `git status --short --branch`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`.
- PR status: none yet for `codex/issue-1048`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
