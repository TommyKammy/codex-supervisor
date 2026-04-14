# Issue #1510: Persist parent epic auto-closure recovery metadata for untracked parent epics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1510
- Branch: codex/issue-1510
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 42f00c07fcfc83ffdef2a2fb030ac1db20a2b260
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T06:13:31.580Z

## Latest Codex Summary
- Reproduced the gap with a focused reconciliation test: `reconcileParentEpicClosures` emitted a recovery event but skipped `state.issues` persistence when the parent epic had no existing record.
- Persisted a synthetic terminal no-PR record for untracked auto-closed parent epics so read-only status surfaces can keep showing `latest_recovery` without re-enabling selection.
- Verified with focused tests and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Parent-epic auto-closure recovery metadata was only durable when `state.issues[parent]` already existed; read-only status derives `latest_recovery` solely from persisted records.
- What changed: Added `createUntrackedRecoveredDoneRecord()` and used it in `reconcileParentEpicClosures()` to synthesize a terminal record for untracked auto-closed parent epics; tightened reconciliation and status-selection tests around that path.
- Current blocker: none
- Next exact step: Commit the checkpoint on `codex/issue-1510` and leave the branch ready for PR creation/update.
- Verification gap: none for the scoped issue acceptance checks.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: Low; the new persisted record is terminal (`state=done`, `pr_number=null`, `blocked_reason=null`) and should remain read-only in selection flows.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproduced failure signature before fix: `untracked-parent-epic-recovery-not-persisted`.
- Focused verification commands:
- `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
- `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- `npx tsx --test src/run-once-cycle-prelude.test.ts`
- `npm run build`
