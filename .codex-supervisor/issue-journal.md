# Issue #970: Reconciliation observability: surface the current target issue, PR, and GitHub wait step

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/970
- Branch: codex/issue-970
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3be269ddce0433ba7e86f1c892c0b4ee25452b75
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T05:07:44.606Z

## Latest Codex Summary
- Added typed reconciliation progress visibility so status can report the active reconciliation phase, current target issue/PR, and any inferred GitHub wait step while reconciliation is running.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: reconciliation only persisted a coarse phase string, so operators could not tell which tracked issue/PR the supervisor was reconciling or which GitHub-side wait gate was delaying convergence.
- What changed: added focused regressions in `src/run-once-cycle-prelude.test.ts` and `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, extended the reconciliation snapshot to carry typed target issue/PR and wait-step context, threaded live progress updates through `runOnceCyclePrelude()`, and taught tracked-PR reconciliation to publish target context plus inferred GitHub wait steps.
- Current blocker: none.
- Next exact step: commit the reconciler observability change on `codex/issue-970`, then open or update the draft PR for review.
- Verification gap: none in the requested local scope after rerunning the focused reconciliation status tests and build.
- Files touched: `src/pull-request-state.ts`, `src/recovery-reconciliation.ts`, `src/run-once-cycle-prelude.ts`, `src/run-once-cycle-prelude.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-reconciliation-phase.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is additive observability over existing reconciliation behavior and reuses existing PR lifecycle wait classification.
- Last focused command: `npm run build`
- Exact failure reproduced: `runOnceCyclePrelude` exposed only phase transitions and `statusReport()` exposed only `reconciliationPhase`, so no status output identified the active reconciliation target issue/PR or GitHub wait step.
- Commands run: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/run-once-cycle-prelude.test.ts`; `npm ci`; `npm run build`.
- PR status: none.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
