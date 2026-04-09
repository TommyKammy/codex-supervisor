# Issue #1375: Refactor: split no-PR and workspace recovery flows out of recovery-reconciliation.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1375
- Branch: codex/issue-1375
- Workspace: .
- Journal: .codex-supervisor/issues/1375/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c8ad088949bbf6eebfcb216ae81965ea55184f8c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T01:17:24.567Z

## Latest Codex Summary
- Extracted workspace/orphan cleanup and failed no-PR stale recovery out of `src/recovery-reconciliation.ts` into dedicated modules, added a direct classifier test, and kept the focused recovery suite plus build green.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `src/recovery-reconciliation.ts` can be reduced to orchestration if workspace/orphan cleanup and failed no-PR reconciliation move behind dedicated modules without changing recovery events or state transitions.
- What changed: Added `src/recovery-workspace-reconciliation.ts` and `src/recovery-no-pr-reconciliation.ts`, rewired `src/recovery-reconciliation.ts` to delegate to them, and added `src/recovery-support.test.ts` to pin `classifyFailedNoPrBranchRecovery` directly. Fixed one transient regression by restoring the tracked-PR direct `getIssue` fallback before dispatching into the split paths.
- Current blocker: none
- Next exact step: stage the refactor files, commit the checkpoint on `codex/issue-1375`, and continue with any follow-up review if needed.
- Verification gap: Full repository test suite was not run; verification covered the issue-targeted recovery tests, the new classifier unit test, and `npm run build`.
- Files touched: src/recovery-reconciliation.ts; src/recovery-workspace-reconciliation.ts; src/recovery-no-pr-reconciliation.ts; src/recovery-support.test.ts; .codex-supervisor/issues/1375/issue-journal.md
- Rollback concern: low; risk is limited to recovery orchestration wiring, especially preserving the tracked-PR inventory-degraded `getIssue` fallback and the exact no-PR recovery event semantics.
- Last focused command: `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern 'workspace|orphan|merged|parent|reservation|failed no-PR|stale stabilizing'`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
