# Issue #1155: Run tracked-PR reconciliation before new issue selection and merge actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1155
- Branch: codex/issue-1155
- Workspace: .
- Journal: .codex-supervisor/issues/1155/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 1be878bb0f203ceb13d8c390dc7b2ac6763ca870
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T06:24:26.384Z

## Latest Codex Summary
Tracked PR reconciliation now runs before new issue reservation and merge-adjacent selection. The prelude no longer reserves a fresh runnable issue ahead of tracked PR refresh, and the early blocked-state recovery remains scoped to tracked PR records so unrelated non-PR scheduling behavior stays in place.

The branch checkpoint is commit `1be878b` (`Run tracked PR reconciliation before selection`). Coverage now includes the new tracked `pr_open` starvation reproducer in `src/run-once-cycle-prelude.test.ts`, the orchestration assertion in `src/supervisor/supervisor-execution-orchestration.test.ts`, and the adjacent reconciliation suites that exercise tracked blocked and stale tracked PR recovery.

Verification: `npm run build` passed. `npx tsx --test src/run-once-cycle-prelude.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` passed. The run still logs the pre-existing non-fatal execution-metrics chronology warnings in timeout/reconciliation fixtures, but the suite completed with no test failures.

Summary: Tracked PR reconciliation is now refreshed before new issue reservation, with stronger regression coverage around tracked `pr_open`, blocked tracked PR recovery, and top-level execution ordering.
State hint: stabilizing
Blocked reason: none
Tests: `npm run build`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
Next action: Push `codex/issue-1155` and open the draft PR from the verified checkpoint.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Tracked PR state must reconcile before any new reservation path so stale `pr_open` and blocked tracked PR records cannot starve merge-ready work.
- What changed: Added a reproducing prelude test, removed the early reservation fast path, narrowed the pre-selection blocked recovery pass to tracked PR records only, forwarded the new option through `Supervisor.startRunOnceCycle`, and updated the higher-level orchestration expectation. Broadened verification across recovery reconciliation and supervisor orchestration coverage.
- Current blocker: none
- Next exact step: Push the verified branch to `github/codex/issue-1155`, open the draft PR, then refresh the journal with the PR reference.
- Verification gap: Full repository test suite not run. The targeted build plus reconciliation/orchestration suites passed. Existing execution-metrics chronology warnings still log in some fixtures without failing the tests.
- Files touched: src/run-once-cycle-prelude.ts; src/recovery-reconciliation.ts; src/supervisor/supervisor.ts; src/run-once-cycle-prelude.test.ts; src/supervisor/supervisor-execution-orchestration.test.ts; .codex-supervisor/issues/1155/issue-journal.md
- Rollback concern: The main risk is accidentally broadening pre-selection blocked recovery again and changing unrelated non-PR issue scheduling.
- Last focused command: npx tsx --test src/run-once-cycle-prelude.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
