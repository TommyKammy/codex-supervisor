# Issue #1215: [codex] Reproduce stale failed tracked PR recovery at run-once orchestration level

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1215
- Branch: codex/issue-1215
- Workspace: .
- Journal: .codex-supervisor/issues/1215/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 47f417c79c14ae8491751979a144a85c814a1596
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T22:09:19.803Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The missing regression should exercise `Supervisor.runOnce` after stale-failed tracked-PR reconciliation, including the same-cycle continuation path where the issue is immediately reselected.
- What changed: Added an orchestration-level test that seeds a `failed` tracked PR on the same head, runs `Supervisor.runOnce({ dryRun: true })`, and asserts the persisted record clears `last_error`, `last_failure_context`, and failure-signature fields after recovery to `draft_pr`.
- Current blocker: None on the focused reproducer; the broader orchestration test file still has a pre-existing assertion mismatch in the local-CI failure message text.
- Next exact step: Commit the regression checkpoint, then decide whether this issue needs an even closer reproducer for the stale-failed behavior or can hand off to the convergence-fix issue with this guard in place.
- Verification gap: `src/supervisor/supervisor-execution-orchestration.test.ts` still fails overall because an older test expects the pre-remediation local-CI block message.
- Files touched: `src/supervisor/supervisor-execution-orchestration.test.ts`; `.codex-supervisor/issues/1215/issue-journal.md`
- Rollback concern: Low; changes only add regression coverage and update the issue journal.
- Last focused command: `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts --test-name-pattern "stale failed tracked PR recovery on the same head"`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
