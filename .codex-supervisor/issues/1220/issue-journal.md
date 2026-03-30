# Issue #1220: [codex] Extract shared tracked PR lifecycle projection for reconciliation and diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1220
- Branch: codex/issue-1220
- Workspace: .
- Journal: .codex-supervisor/issues/1220/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 476cb56127cbb02e61df0b23461a05fb26faecee
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-30T23:06:17.402Z

## Latest Codex Summary
Extracted a shared tracked PR lifecycle projection into [src/tracked-pr-lifecycle-projection.ts](src/tracked-pr-lifecycle-projection.ts) and switched both [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts) and [src/supervisor/tracked-pr-mismatch.ts](src/supervisor/tracked-pr-mismatch.ts) to use it. I added focused coverage in [src/tracked-pr-lifecycle-projection.test.ts](src/tracked-pr-lifecycle-projection.test.ts) for blocked, `draft_pr`, `ready_to_merge`, and failed-suppression projections.

Checkpoint commits are on `codex/issue-1220` at `476cb56`, pushed to `github`, and draft PR [#1223](https://github.com/TommyKammy/codex-supervisor/pull/1223) is open. Focused test suites passed. `npm run build` could not complete here because `tsc` is not installed in this workspace.

Summary: Extracted a shared tracked PR lifecycle projection helper, refactored reconciliation and diagnostics to use it, added focused projection tests, pushed the branch, and opened draft PR #1223.
State hint: draft_pr
Blocked reason: verification
Tests: `npx tsx --test src/tracked-pr-lifecycle-projection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build` failed because `tsc` was not found
Next action: Let CI run on PR #1223 and, if full local verification is still needed, install/restore the TypeScript toolchain and rerun `npm run build`
Failure signature: build (ubuntu-latest):fail|build (macos-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1223 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1223
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23771937576/job/69265197904
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23771937576/job/69265197888

## Codex Working Notes
### Current Handoff
- Hypothesis: PR #1223 failed only because `reconcileStaleFailedIssueStates` still typed `syncCopilotReviewTimeoutState` as returning `Partial<IssueRunRecord>`, while the extracted lifecycle projection now requires the stricter three-field timeout patch shape from `syncCopilotReviewTimeoutState`.
- What changed: tightened `src/recovery-reconciliation.ts` to use `typeof syncCopilotReviewTimeoutState` for that dependency and replaced five `{}` timeout test stubs in `src/supervisor/supervisor-recovery-reconciliation.test.ts` with an explicit null-valued timeout patch helper.
- Current blocker: none.
- Next exact step: commit the CI repair, push `codex/issue-1220`, and let PR #1223 rerun the build workflow.
- Verification gap: none locally for the targeted repair; remote CI rerun still pending until the branch is pushed.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issues/1220/issue-journal.md`.
- Rollback concern: low; the change only aligns a dependency type with the existing projection contract and makes test doubles return the same null timeout fields as production.
- Last focused commands: `gh run view 23771937576 --log-failed`; `npm ci`; `npm run build`; `npx tsx --test src/tracked-pr-lifecycle-projection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
