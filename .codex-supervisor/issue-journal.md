# Issue #1291: [codex] Separate stale no-PR recovery budget from implementation attempts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1291
- Branch: codex/issue-1291
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dad4210b1b7dd5b4c4b01679fc10a7e85656f96a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-03T23:11:34.457Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The stale no-PR recovery path was still hitting the generic implementation-attempt gate in `resolveRunnableIssueContext`, so a recoverable stale cleanup could fail before its own stale recovery retry budget was exhausted.
- What changed: Added a regression test for exhausted implementation attempts during queued stale no-PR recovery, added a no-PR helper to detect when stale recovery budget still applies, and skipped the implementation budget gate for that specific queued stale-recovery case so exhaustion diagnostics now end at the stale recovery loop rather than the implementation lane.
- Current blocker: none
- Next exact step: Push or open/update the draft PR with the checkpoint commit if the supervisor wants the branch published now.
- Verification gap: none for the scoped change; requested focused tests and build passed locally.
- Files touched: .codex-supervisor/issue-journal.md; src/no-pull-request-state.ts; src/no-pull-request-state.test.ts; src/supervisor/supervisor.ts; src/supervisor/supervisor-execution-orchestration.test.ts
- Rollback concern: The new bypass is intentionally narrow to queued no-PR stale recovery with remaining stale retry budget; if broadened accidentally it could weaken the normal implementation-attempt guardrail for ordinary no-PR work.
- Last focused command: npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts && npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
