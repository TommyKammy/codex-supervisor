# Issue #1354: Bug: tracked PR can wedge after current-head repair push when stale local review and processed bot thread coexist

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1354
- Branch: codex/issue-1354
- Workspace: .
- Journal: .codex-supervisor/issues/1354/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 375b64cab6398b2dee32124e3b78d1dd26d51007
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T12:36:37.325Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The reconciliation reset only treated a tracked PR as divergent when `last_head_sha` changed, so partially persisted current-head records could keep stale local-review and processed-thread state and remain wedged.
- What changed: Added focused regressions for the same-head partial-persistence case and updated tracked PR head-scoped reset logic to clear stale local review, follow-up, local CI, blocker-comment, and processed review-thread state whenever any of those fields still point at an older head.
- Current blocker: none
- Next exact step: Commit the reconciliation fix on `codex/issue-1354` and leave the branch ready for PR creation/update.
- Verification gap: none for the targeted regression path; requested test suite and build passed locally.
- Files touched: src/tracked-pr-lifecycle-projection.ts; src/recovery-reconciliation.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts
- Rollback concern: Low; the change only broadens when existing tracked-PR head-scoped reset state is considered stale, so the main risk would be over-resetting current-head review bookkeeping if another head-scoped stale marker was misclassified.
- Last focused command: npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
