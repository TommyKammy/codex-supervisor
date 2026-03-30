# Issue #1221: [codex] Separate tracked PR convergence patches from recovery-event generation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1221
- Branch: codex/issue-1221
- Workspace: .
- Journal: .codex-supervisor/issues/1221/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: ced59de15d5323cc890005f50ab95be5d9f9d6b2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T23:24:16.232Z

## Latest Codex Summary
Separated the tracked-PR stale-failure persisted patch from recovery-event generation in [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts). The new exported helper, `buildTrackedPrStaleFailureConvergencePatch`, now owns the authoritative state patch, while recovery events are built explicitly at the call sites. I also added a direct regression test in [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts) so stale failure-field clearing and resumed blocked-state assembly can be exercised without depending on recovery-event text.

Follow-up stabilization restored local dev dependencies with `npm ci`, exposed a stale test import in [src/recovery-reconciliation.test.ts](src/recovery-reconciliation.test.ts) during `npm run build`, and updated that test to target `buildTrackedPrStaleFailureConvergencePatch` directly instead of the removed mixed-responsibility helper. Focused regression tests and the TypeScript build now pass.

Summary: Separated tracked PR stale-failure convergence patch assembly from recovery-event generation, then fixed the remaining stale test import so focused tests and `npm run build` both pass.
State hint: stabilizing
Blocked reason: none
Tests: `npm ci` completed; `npx tsx --test src/recovery-reconciliation.test.ts` passed; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` passed; `npm run build` passed
Next action: Commit the stabilization fix and leave the branch ready for review or draft PR creation
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The stale failed tracked-PR reconciliation path mixed persisted-state patch construction with recovery-event formatting; a patch-only helper should preserve behavior while making the convergence boundary directly testable.
- What changed: Added `buildTrackedPrStaleFailureConvergencePatch` in `src/recovery-reconciliation.ts`, updated stale-failed and blocked tracked-PR recovery call sites to build the recovery event separately, added a focused direct unit test in `src/supervisor/supervisor-recovery-reconciliation.test.ts`, and updated `src/recovery-reconciliation.test.ts` to stop importing the removed `buildTrackedPrStaleFailureRecovery` helper.
- Current blocker: none
- Next exact step: Commit the test-fix checkpoint and either open or update the draft PR from `codex/issue-1221`.
- Verification gap: none for the requested focused tests and build; the focused recovery test run still emits the existing expected execution-metrics chronology warnings in fixture scenarios while passing.
- Files touched: src/recovery-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/recovery-reconciliation.test.ts; .codex-supervisor/issues/1221/issue-journal.md
- Rollback concern: Low; the change keeps recovery-event strings intact and only separates persisted patch assembly from event generation.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
