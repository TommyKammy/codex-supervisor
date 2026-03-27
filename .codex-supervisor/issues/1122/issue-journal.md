# Issue #1122: Extract stale tracked-PR recovery policy from recovery reconciliation orchestration

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1122
- Branch: codex/issue-1122
- Workspace: .
- Journal: .codex-supervisor/issues/1122/issue-journal.md
- Current phase: stabilizing
- Attempt count: 3 (implementation=3, repair=0)
- Last head SHA: 2b2c8e19d3bddc26d9dc1938b398e232cc3fb034
- Blocked reason: none
- Last failure signature: handoff-missing
- Repeated failure signature count: 1
- Updated at: 2026-03-27T15:09:28.229Z

## Latest Codex Summary
Extracted the stale tracked-PR failed-state policy into `buildTrackedPrStaleFailureRecovery` and left [`src/recovery-reconciliation.ts`](src/recovery-reconciliation.ts) focused on orchestration. Added focused regression coverage in [`src/recovery-reconciliation.test.ts`](src/recovery-reconciliation.test.ts) for both tracked head-advance recovery and same-head blocked/manual-review recovery, reran broader verification after installing the lockfile-pinned dev dependencies, and opened draft PR #1129 (`[codex] Extract tracked PR stale failure recovery policy`).

Focused verification passed:
`npx tsx --test src/recovery-reconciliation.test.ts`
`npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
`npm run build`

Broader verification:
`npm test` failed in unrelated existing suites: `src/backend/webui-dashboard-browser-smoke.test.ts`, `src/family-directory-layout.test.ts`, and `src/supervisor/supervisor-status-rendering.test.ts`

Summary: Extracted stale tracked-PR recovery patch/event policy into a reusable helper, added focused regression tests, verified the branch with a successful build, and opened draft PR #1129.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `npm test` (unrelated failures in `src/backend/webui-dashboard-browser-smoke.test.ts`, `src/family-directory-layout.test.ts`, and `src/supervisor/supervisor-status-rendering.test.ts`)
Next action: Monitor draft PR #1129 and address only review or CI findings that touch the extracted recovery policy scope.
Failure signature: unrelated-full-suite-baseline

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The extracted tracked-PR stale-failure helper preserves existing recovery behavior while keeping the reconciler orchestration narrow enough for future policy-only fixes.
- What changed: Added `buildTrackedPrStaleFailureRecovery` in `src/recovery-reconciliation.ts`, updated `reconcileStaleFailedIssueStates` to delegate to it, added focused regression tests in `src/recovery-reconciliation.test.ts`, installed the repo dev dependencies with `npm ci`, reran focused reconciliation tests plus `npm run build`, pushed `codex/issue-1122`, and opened draft PR #1129.
- Current blocker: none
- Next exact step: Wait for PR feedback or CI signal and only re-enter implementation if a finding touches the extracted tracked-PR recovery behavior.
- Verification gap: No known gap for the changed reconciliation behavior; repo-wide `npm test` still has unrelated existing failures in browser smoke, family-directory-layout, and supervisor-status-rendering suites.
- Files touched: `src/recovery-reconciliation.ts`, `src/recovery-reconciliation.test.ts`, `.codex-supervisor/issues/1122/issue-journal.md`
- Rollback concern: Low; the helper is a straight extraction of the existing stale failed tracked-PR patch/event logic and the existing supervisor reconciliation tests still pass.
- Last focused command: `npx tsx --test src/recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `npm test`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
