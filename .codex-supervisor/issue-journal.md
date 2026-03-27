# Issue #1105: Rehydrate stale failed tracked PRs from direct PR facts when inventory refresh is degraded

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1105
- Branch: codex/issue-1105
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T05:00:47.625Z

## Latest Codex Summary
- Reproduced the degraded-inventory stale-failed tracked-PR gap with focused tests, then fixed the degraded prelude and stale-failed reconciliation path so failed tracked PR records can recover from direct issue/PR facts even when full inventory refresh fails.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: degraded prelude can safely run stale-failed tracked-PR reconciliation for non-active failed records, as long as the stale-failed helper falls back to direct issue facts when the full issue inventory is unavailable.
- What changed: updated `runOnceCyclePrelude()` to invoke `reconcileStaleFailedIssueStates()` during degraded inventory handling when non-active failed tracked PR records exist, and updated `reconcileStaleFailedIssueStates()` to fetch the issue directly when the full inventory payload is missing. Added focused regressions for the degraded prelude path and for stale-failed recovery from direct issue facts.
- Current blocker: none locally.
- Next exact step: review the final diff, commit this `#1105` checkpoint on `codex/issue-1105`, and if another pass is needed afterward exercise a full run-once supervisor path around degraded inventory plus stale failed tracked PR recovery.
- Verification gap: I have not run the full repository suite or an end-to-end supervisor loop; verification so far is focused on `run-once-cycle-prelude` and stale-failed reconciliation tests.
- Files touched: `src/run-once-cycle-prelude.ts`; `src/run-once-cycle-prelude.test.ts`; `src/recovery-reconciliation.ts`; `src/supervisor/supervisor-recovery-reconciliation.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The new degraded-mode path only activates when full inventory refresh fails and there is at least one non-active failed tracked PR record; unrelated failed records and the existing active tracked fast path remain unchanged.
- Last focused command: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
- What changed this turn: reread the required memory files and journal, traced the degraded prelude early return, added focused failing regressions for degraded stale-failed tracked-PR recovery, updated the prelude to run stale-failed reconciliation during degraded refresh, taught stale-failed reconciliation to fetch direct issue facts when the full inventory list is absent, and reran the focused tests successfully.
- Exact failure reproduced this turn: when `listAllIssues()` failed and `activeIssueNumber=null`, `runOnceCyclePrelude()` returned after persisting `inventory_refresh_failure`, so `reconcileStaleFailedIssueStates()` never ran; even if invoked with an empty inventory list, the stale-failed reconciler skipped the record because it only trusted issue openness from the missing full inventory payload.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1105/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1105/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `git log --oneline --decorate -5`; `rg -n "inventory refresh|degraded|stale failed|tracked_pr_head_advanced|direct PR facts|activeIssueNumber|full inventory" src -g'*.ts'`; `sed -n '1,360p' src/run-once-cycle-prelude.ts`; `sed -n '320,470p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,420p' src/recovery-reconciliation.ts`; `rg -n "reconcileStaleFailedIssueStates|tracked_pr_head_advanced|last_head_sha|last_failure_signature" src/recovery-reconciliation.ts src/run-once-cycle-prelude.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '980,1220p' src/recovery-reconciliation.ts`; `sed -n '360,760p' src/run-once-cycle-prelude.test.ts`; `rg -n "runOnceCyclePrelude\\(|reconcileStaleFailedIssueStates\\(" src/supervisor src -g'*.ts'`; `sed -n '1,260p' src/supervisor/supervisor.ts`; `sed -n '1880,2135p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '1,220p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,220p' src/supervisor/supervisor-test-helpers.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `git diff -- src/run-once-cycle-prelude.ts src/run-once-cycle-prelude.test.ts src/recovery-reconciliation.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `git status --short`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
