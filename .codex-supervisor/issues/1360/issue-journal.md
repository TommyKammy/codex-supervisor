# Issue #1360: Refactor: extract read-only report commands from supervisor.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1360
- Branch: codex/issue-1360
- Workspace: .
- Journal: .codex-supervisor/issues/1360/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: beaece73bdc60e1594052d2f721ef962834efefe
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T22:19:34.428Z

## Latest Codex Summary
- Extracted read-only report assembly from `src/supervisor/supervisor.ts` into `src/supervisor/supervisor-read-only-reporting.ts`, added a boundary test to keep the public methods thin delegators, and kept the focused diagnostics/build suite green.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `statusReport`, `explainReport`, `doctorReport`, and `setupReadinessReport` can move behind a dedicated reporting module without changing DTOs or rendered output if `Supervisor` only forwards config/github/state-store dependencies.
- What changed: Added `src/supervisor/supervisor-read-only-reporting.ts`, reduced the four `Supervisor` report methods to delegators, and added `src/supervisor/supervisor-read-only-reporting-boundary.test.ts` to enforce that shape.
- Current blocker: none
- Next exact step: Commit the refactor checkpoint on `codex/issue-1360` and continue with any broader verification only if the supervisor requests it.
- Verification gap: Focused issue verification and `npm run build` are green; the full repository test suite was not run.
- Files touched: `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-read-only-reporting.ts`; `src/supervisor/supervisor-read-only-reporting-boundary.test.ts`
- Rollback concern: Low; the change is mostly code motion plus a structural guard test, but `supervisor-read-only-reporting.ts` now owns status-only helpers such as reconciliation warning and JSON state diagnostics.
- Last focused command: `npx tsx --test src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-read-only-reporting-boundary.test.ts && npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
