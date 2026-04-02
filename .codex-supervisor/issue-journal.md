# Issue #1281: Auto-resume failed no-PR issues when the workspace branch is already ahead and recoverable

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1281
- Branch: codex/issue-1281
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7bd2a2ef32da117ff62a5cd7f180ba4ede4e4496
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-02T21:58:34.459Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Failed no-PR records were stranded because stale-failed reconciliation skipped every `pr_number == null` record; a strict ahead-of-default-branch probe can safely auto-requeue transient no-PR failures.
- What changed: Added strict failed no-PR branch recovery in reconciliation, widened degraded prelude reconciliation to consider all failed records, and added focused regression coverage for recoverable-ahead and supervisor-artifact-only cases.
- Current blocker: none
- Next exact step: Commit the recovery slice, then continue with PR/draft-PR follow-up if needed.
- Verification gap: No broader status/explain-specific diagnostic assertion was added beyond the recovery event/state transition coverage.
- Files touched: src/recovery-reconciliation.ts; src/run-once-cycle-prelude.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts
- Rollback concern: The new probe intentionally fail-closes ambiguous or unsafe workspaces; if operators expected auto-resume for dirty-only no-PR failures, this change will keep those manual.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
