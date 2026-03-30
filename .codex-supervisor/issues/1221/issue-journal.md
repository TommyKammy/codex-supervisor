# Issue #1221: [codex] Separate tracked PR convergence patches from recovery-event generation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1221
- Branch: codex/issue-1221
- Workspace: .
- Journal: .codex-supervisor/issues/1221/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ee277a95bbc788dd955528a642f633350e0a2d75
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T23:19:04.491Z

## Latest Codex Summary
- Extracted tracked PR stale-failure persisted-state patch construction into a dedicated helper and added a direct regression test for the convergence patch boundary.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The stale failed tracked-PR reconciliation path mixed persisted-state patch construction with recovery-event formatting; a patch-only helper should preserve behavior while making the convergence boundary directly testable.
- What changed: Added `buildTrackedPrStaleFailureConvergencePatch` in `src/recovery-reconciliation.ts`, updated stale-failed and blocked tracked-PR recovery call sites to build the recovery event separately, and added a focused direct unit test in `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Current blocker: none
- Next exact step: Commit the refactor checkpoint; if full verification is required beyond tests, restore dev dependencies so `npm run build` can find `tsc` and rerun it.
- Verification gap: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` passed; `npm run build` failed because `tsc` is not installed in the current environment (`sh: 1: tsc: not found`).
- Files touched: src/recovery-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; .codex-supervisor/issues/1221/issue-journal.md
- Rollback concern: Low; the change keeps recovery-event strings intact and only separates persisted patch assembly from event generation.
- Last focused command: npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
