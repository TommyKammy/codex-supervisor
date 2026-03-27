# Issue #1122: Extract stale tracked-PR recovery policy from recovery reconciliation orchestration

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1122
- Branch: codex/issue-1122
- Workspace: .
- Journal: .codex-supervisor/issues/1122/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T14:15:25.500Z

## Latest Codex Summary
- Extracted stale tracked-PR failed-state recovery patch/event policy into `buildTrackedPrStaleFailureRecovery`, kept `reconcileStaleFailedIssueStates` orchestration-focused, and added focused unit coverage for head-advance vs lifecycle recovery behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The stale tracked-PR recovery behavior can be preserved while extracting a pure helper that owns recovery-event selection and record patch generation for stale failed tracked PRs.
- What changed: Added `buildTrackedPrStaleFailureRecovery` in `src/recovery-reconciliation.ts`, updated `reconcileStaleFailedIssueStates` to delegate to it, and added focused regression tests in `src/recovery-reconciliation.test.ts` covering tracked head advancement and same-head blocked/manual-review recovery.
- Current blocker: none
- Next exact step: Commit the extraction and focused tests, then hand back with focused verification results.
- Verification gap: Full `npm test` and `npm run build` were not rerun; only focused reconciliation tests were executed.
- Files touched: `src/recovery-reconciliation.ts`, `src/recovery-reconciliation.test.ts`, `.codex-supervisor/issues/1122/issue-journal.md`
- Rollback concern: Low; the helper is a straight extraction of the existing stale failed tracked-PR patch/event logic and the existing supervisor reconciliation tests still pass.
- Last focused command: `npx tsx --test src/recovery-reconciliation.test.ts` and `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
