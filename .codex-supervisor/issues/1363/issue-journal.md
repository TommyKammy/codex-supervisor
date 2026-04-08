# Issue #1363: Refactor: split tracked-PR recovery flows out of recovery-reconciliation.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1363
- Branch: codex/issue-1363
- Workspace: .
- Journal: .codex-supervisor/issues/1363/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dd16cb026d70c414362b3ea0b9bc367dcc3b8eed
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T23:15:34.105Z

## Latest Codex Summary
- Extracted tracked-PR merge convergence and stale-failed tracked-PR recovery flow into `src/recovery-tracked-pr-reconciliation.ts` while keeping `src/recovery-reconciliation.ts` public entrypoints stable. Focused tracked-PR reconciliation tests and `npm run build` passed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The refactor can be completed safely by moving tracked-PR-specific reconciliation mechanics into a dedicated module while preserving the existing public entrypoints and recovery-event semantics in `src/recovery-reconciliation.ts`.
- What changed: Added `src/recovery-tracked-pr-reconciliation.ts` for tracked merged-PR convergence, tracked stale-failed recovery, and tracked resume event formatting; rewired `reconcileTrackedMergedButOpenIssues` and the tracked-PR branch inside `reconcileStaleFailedIssueStates` to delegate into that module.
- Current blocker: none
- Next exact step: Review the final diff for any further cleanup worth folding into the extraction, then stage the refactor and create a checkpoint commit on `codex/issue-1363`.
- Verification gap: Full issue verification command from the issue body has not been run beyond the focused tracked-PR slice; current confidence comes from the targeted tracked-PR tests plus `npm run build`.
- Files touched: `.codex-supervisor/issues/1363/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/recovery-tracked-pr-reconciliation.ts`
- Rollback concern: Low to medium; the new module duplicates a few tracked-PR-only helpers that still also exist in `src/recovery-reconciliation.ts`, so any later cleanup should avoid changing non-tracked reconciliation behavior accidentally.
- Last focused command: `npx tsx --test src/recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern 'tracked|repair push|stale|same-head|processed'`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
