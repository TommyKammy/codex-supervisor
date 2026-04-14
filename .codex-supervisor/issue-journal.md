# Issue #1515: Bug: run-once --dry-run burns tracked-PR reconciliation budget on terminal done records

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1515
- Branch: codex/issue-1515
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7534702f0a1afe18257f5bba0caeacfbd4d3dc84
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T07:55:57.498Z

## Latest Codex Summary
- Reproduced the budget-burn regression with focused tests, then changed tracked-PR reconciliation to prioritize non-`done` tracked PR records ahead of historical `done + pr_number` records in the default slice.
- Added regression coverage in the reconciliation suite and a prelude-level test that wires the real reconciliation path through `runOnceCyclePrelude`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The default `reconcileTrackedMergedButOpenIssuesInModule(...)` candidate list was iterating tracked PR records in raw issue-number order, so large tails of historical `done + pr_number` records exhausted the default 25-record budget before recoverable tracked PR work was reached.
- What changed: Added `prioritizeTrackedMergedButOpenRecords(...)` in `src/recovery-tracked-pr-reconciliation.ts` so the default pass processes non-`done` tracked PR records before historical `done` records while preserving round-robin resume ordering inside each tier. Added direct and prelude-level regressions for the `800 !== 901` failure mode.
- Current blocker: none
- Next exact step: Review diff and create a checkpoint commit on `codex/issue-1515`.
- Verification gap: none for requested local checks; targeted tests and build passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-tracked-pr-reconciliation.ts`, `src/run-once-cycle-prelude.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: Low; change only affects default ordering for tracked-PR reconciliation when scanning multiple records and leaves `onlyIssueNumber` behavior intact.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
