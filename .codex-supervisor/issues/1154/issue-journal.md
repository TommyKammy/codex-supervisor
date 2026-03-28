# Issue #1154: Invalidate stale review-blocker signatures when same-head GitHub review state improves

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1154
- Branch: codex/issue-1154
- Workspace: .
- Journal: .codex-supervisor/issues/1154/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 23a15259ea2f621d6ea0f68ff8fedd841b601a5a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T05:04:30.429Z

## Latest Codex Summary
- Added same-head stale review-blocker regression coverage for both `runOnce` and blocked-state reconciliation.
- Updated blocked tracked-PR reconciliation to refresh same-head `manual_review` records from live PR/check/thread facts and clear stale `stalled-bot:*` signatures when GitHub now reports the blocker resolved.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `blocked/manual_review` tracked PR records were terminal for issue selection, so same-head GitHub thread resolution could not clear stale `stalled-bot:*` signatures unless a non-terminal path re-entered normal PR lifecycle evaluation.
- What changed: Added same-head stale-blocker tests in `src/supervisor/supervisor-pr-review-blockers.test.ts` and `src/supervisor/supervisor-recovery-reconciliation.test.ts`; extended `reconcileRecoverableBlockedIssueStates` to refresh same-head blocked tracked PRs from live PR/check/thread state and rewrite or clear stale review failure context/signatures when the derived lifecycle changes.
- Current blocker: none.
- Next exact step: commit the focused reconciliation fix and, if needed, open/update the draft PR for branch `codex/issue-1154`.
- Verification gap: Focused tests passed for the touched PR lifecycle and reconciliation paths; no broader full-suite or build run yet.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-pr-review-blockers.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Rollback concern: Low; the new reconciliation path only applies to same-head tracked PR records already blocked on `manual_review`, and it no-ops when the derived blocked reason/signature is unchanged.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
