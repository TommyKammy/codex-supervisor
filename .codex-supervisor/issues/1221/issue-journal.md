# Issue #1221: [codex] Separate tracked PR convergence patches from recovery-event generation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1221
- Branch: codex/issue-1221
- Workspace: .
- Journal: .codex-supervisor/issues/1221/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 4 (implementation=3, repair=1)
- Last head SHA: 70c9202cf641c5e9ef26fa4fc547b7d8bdeb0332
- Blocked reason: none
- Last failure signature: dirty:70c9202cf641c5e9ef26fa4fc547b7d8bdeb0332
- Repeated failure signature count: 1
- Updated at: 2026-03-30T23:37:26.827Z

## Latest Codex Summary
PR #1225 was dirty against `main`, so I stashed the tracked journal edit, fetched `github/main` to `0fb5238`, merged it into `codex/issue-1221`, resolved the single content conflict in `src/recovery-reconciliation.ts` by keeping the dedicated tracked-PR convergence patch boundary on top of the new shared lifecycle projection, reran the focused recovery tests plus `src/tracked-pr-lifecycle-projection.test.ts`, rebuilt successfully, and pushed the refreshed branch. This journal update records the conflict-repair handoff.

Summary: Merged `github/main` into `codex/issue-1221`, resolved the tracked-PR recovery conflict, reverified, and pushed PR #1225
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/tracked-pr-lifecycle-projection.test.ts`; `npm run build`
Next action: Monitor PR #1225 after the merge-repair push and address any CI or review feedback from `codex/issue-1221`
Failure signature: none

## Active Failure Context
- None recorded. The prior PR dirty state was cleared by merging `github/main` at `0fb5238` and pushing `eb043e3`.

## Codex Working Notes
### Current Handoff
- Hypothesis: The stale failed tracked-PR reconciliation path mixed persisted-state patch construction with recovery-event formatting; a patch-only helper should preserve behavior while making the convergence boundary directly testable.
- What changed: Merged `github/main` at `0fb5238` into `codex/issue-1221`, resolved the only content conflict in `src/recovery-reconciliation.ts` by keeping `buildTrackedPrStaleFailureConvergencePatch` and `buildTrackedPrResumeRecoveryEvent` while adopting the shared `projectTrackedPrLifecycle` projection from `main`, reran the focused recovery/orchestration tests plus `src/tracked-pr-lifecycle-projection.test.ts`, rebuilt successfully, and pushed merge commit `eb043e3` to PR #1225.
- Current blocker: none
- Next exact step: Wait for CI on PR #1225 and address any follow-up review or check failures from the refreshed branch if they appear.
- Verification gap: none for the focused recovery/orchestration tests, the lifecycle projection test, and the TypeScript build; the test run still emits the existing expected execution-metrics chronology warnings in fixture scenarios while passing.
- Files touched: src/recovery-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/tracked-pr-mismatch.ts; src/tracked-pr-lifecycle-projection.ts; src/tracked-pr-lifecycle-projection.test.ts; .codex-supervisor/issues/1220/issue-journal.md; .codex-supervisor/issues/1221/issue-journal.md
- Rollback concern: Low; the resolution preserved the explicit persisted tracked-PR convergence patch boundary while taking the new shared lifecycle projection from `main`.
- Last focused commands: `git fetch github main`; `git merge github/main`; `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/tracked-pr-lifecycle-projection.test.ts`; `npm run build`; `git push github codex/issue-1221`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
