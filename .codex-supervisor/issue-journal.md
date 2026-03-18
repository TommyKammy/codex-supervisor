# Issue #514: Post-merge reconciliation: recover tracked issues left stuck in merging after PR merge

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/514
- Branch: codex/issue-514
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-514
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-514/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 50f581c012a2c2f514bb11c24382020bbdc5993f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T01:15:08.754Z

## Latest Codex Summary
- Reproduced the stuck post-merge `merging` case with a focused reconciliation test, fixed the refresh path so later reconciliation re-fetches open issue snapshots for merged tracked PRs before applying the existing merge-time safety gate, and verified the focused reconciliation/lifecycle suites plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale open issue snapshots in the preloaded issue list can strand a tracked `merging` record after its PR already merged because reconciliation never refreshes the issue before checking the merge-time close gate.
- What changed: `reconcileTrackedMergedButOpenIssues()` now re-fetches the live issue only for open `merging` records whose tracked PR is already merged, then reuses the existing `updatedAt <= mergedAt` safety gate and normal close-to-done convergence path; added a focused regression covering the stale-open-snapshot recovery case.
- Current blocker: none
- Next exact step: commit this focused reconciliation fix and, if no PR exists yet, open a draft PR from `codex/issue-514`.
- Verification gap: none locally after rerunning the focused reconciliation/lifecycle suites and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: if the `merging`-only refresh is removed, later cycles can keep trusting stale open issue snapshots and leave merged tracked issues stranded instead of converging them to `done`.
- Last focused command: `npm run build`

### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Added `reconcileTrackedMergedButOpenIssues refreshes open issue snapshots for merging records before applying the merge-time gate`; the first focused run failed because `getIssue` was never called for an open preloaded issue, yielding failure signature `stale-merging-issue-snapshot`.
- 2026-03-18 (JST): Narrow fix: when a tracked PR is already merged and the local record is still `merging`, reconciliation now refreshes the live issue snapshot before applying the existing merge-time close gate, allowing later cycles to close the GitHub issue and mark the record `done`.
- 2026-03-18 (JST): Verified with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`, `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts`, and `npm run build`.
- 2026-03-18 (JST): `npm run build` initially failed in this worktree with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
