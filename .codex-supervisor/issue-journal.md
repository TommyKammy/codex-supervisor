# Issue #1528: Perf: bound tracked_merged_but_open_issues reconciliation on large hosts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1528
- Branch: codex/issue-1528
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c6699985f008033c5ac92f965a84c68729193330
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T12:21:28.003Z

## Latest Codex Summary
- Added bounded-backlog observability for `tracked_merged_but_open_issues`: recovery events now say when a pass deferred remaining tracked PR backlog, and status/doctor now surface the persisted resume cursor and backlog counts.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `tracked_merged_but_open_issues` was already cursor-backed and capped, but operators still lacked a clear signal that a pass intentionally stopped early and would resume from persisted state next cycle.
- What changed: Added a bounded-backlog recovery event in tracked PR reconciliation; added shared tracked-backlog diagnostics used by read-only status and doctor; expanded focused tests and updated supervisor reconciliation expectations for the new event.
- Current blocker: none
- Next exact step: stage the code+journal changes, commit the checkpoint on `codex/issue-1528`, and leave the branch ready for PR/update work.
- Verification gap: none for the targeted issue scope; broader unrelated suites were not rerun beyond the focused reconciliation and diagnostics coverage.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-tracked-pr-reconciliation.ts`, `src/reconciliation-backlog-diagnostics.ts`, `src/supervisor/supervisor-read-only-reporting.ts`, `src/doctor.ts`, `src/recovery-tracked-pr-reconciliation.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: low; the new runtime behavior is additive observability plus one extra recovery event on bounded passes, but any automation that assumed an exact single-event list for tracked PR bounded passes would need the updated expectations already included here.
- Last focused command: `npx tsx --test src/recovery-tracked-pr-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
