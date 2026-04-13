# Issue #1486: Stale local verification blockers can keep tracked PRs draft after newer head turns green

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1486
- Branch: codex/issue-1486
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c805fb4cfdbb6fa79fc14795a194f6ac7c0f89be
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-13T17:40:02.399Z

## Latest Codex Summary
- Cleared stale tracked-PR ready-promotion verification blockers on head advance, added a focused reconciliation regression, and updated diagnostics so stale stored blockers are described as stale instead of “still present.”

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileRecoverableBlockedIssueStates(...)` was preserving `last_failure_context` for draft ready-promotion blockers even when the tracked PR head had advanced and fresh current-head inference returned no blocker.
- What changed: Guarded draft ready-promotion blocker preservation so old-head verification context only survives when the blocker is still on the same head or there is fresh current-head failure evidence; added a regression that advances from `head-old` to `head-new`; updated tracked-PR mismatch guidance in status/doctor so stale stored blockers are called out as stale.
- Current blocker: none
- Next exact step: Commit the tested fix on `codex/issue-1486` and leave the branch ready for PR/update.
- Verification gap: `src/supervisor/supervisor-diagnostics-explain.test.ts` was not changed because the affected wording is covered through status and doctor paths; no failing explain coverage surfaced during targeted verification.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/tracked-pr-mismatch.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/doctor.test.ts`
- Rollback concern: low; the behavioral change is narrowly scoped to draft tracked-PR verification blocker preservation and diagnostic wording when the stored blocker belongs to an older head.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
