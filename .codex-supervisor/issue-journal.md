# Issue #1510: Persist parent epic auto-closure recovery metadata for untracked parent epics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1510
- Branch: codex/issue-1510
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 2b6619f6b9d303d9fa03aeeb481d97ca77f362a3
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856uaRt
- Repeated failure signature count: 1
- Updated at: 2026-04-14T06:32:33.292Z

## Latest Codex Summary
Persisted parent-epic auto-closure recovery metadata when the parent had no prior `state.issues` record. The fix synthesizes a terminal no-PR `done` record during `reconcileParentEpicClosures`, applies the same recovery metadata patch used for tracked parents, and leaves it non-runnable. I also tightened tests for the untracked-parent reconciliation path and for the read-only status surface to confirm the recovered parent epic remains out of selection.

Verification passed with the focused suites and build:
`npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/run-once-cycle-prelude.test.ts`
and `npm run build`.

Checkpoint commit: `2b6619f` (`Persist recovery metadata for untracked parent epics`)

There are still untracked supervisor artifacts in the worktree:
`.codex-supervisor/pre-merge/`, `.codex-supervisor/replay/`, `.codex-supervisor/turn-in-progress.json`

Summary: Persisted `latest_recovery` metadata for untracked auto-closed parent epics via a synthetic terminal record; focused tests and build pass; checkpoint committed as `2b6619f`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`
Next action: Open or update a draft PR from `codex/issue-1510`, noting the committed fix and leaving the untracked supervisor artifacts out of the PR.
Failure signature: PRRT_kwDORgvdZ856uaRt

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1511#discussion_r3077509698
- Details:
  - .codex-supervisor/issue-journal.md:29 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Update the next-step note to reflect current PR status.** Line 29 says to “Commit the checkpoint,” but this PR already has checkpoint commit ... url=https://github.com/TommyKammy/codex-supervisor/pull/1511#discussion_r3077509698

## Codex Working Notes
### Current Handoff
- Hypothesis: Parent-epic auto-closure recovery metadata was only durable when `state.issues[parent]` already existed; read-only status derives `latest_recovery` solely from persisted records.
- What changed: Added `createUntrackedRecoveredDoneRecord()` and used it in `reconcileParentEpicClosures()` to synthesize a terminal record for untracked auto-closed parent epics; tightened reconciliation and status-selection tests around that path.
- Current blocker: none
- Next exact step: Open or update the draft PR from `codex/issue-1510` and note checkpoint commit `2b6619f`.
- Verification gap: none for the scoped issue acceptance checks.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: Low; the new persisted record is terminal (`state=done`, `pr_number=null`, `blocked_reason=null`) and should remain read-only in selection flows.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproduced failure signature before fix: `untracked-parent-epic-recovery-not-persisted`.
- Addressed review signature: `PRRT_kwDORgvdZ856uaRt`.
- Review-fix command: updated `.codex-supervisor/issue-journal.md` handoff note to match committed PR state.
- Focused verification commands:
- `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
- `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- `npx tsx --test src/run-once-cycle-prelude.test.ts`
- `npm run build`
