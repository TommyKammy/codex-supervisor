# Issue #971: Post-merge fast-path: converge an active merged issue before unrelated broad reconciliation work

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/971
- Branch: codex/issue-971
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d456da0ed9f498ead6407f78742fcddb1757ed3f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T05:53:11.689Z

## Latest Codex Summary
- Added an active-merged fast-path in `runOnceCyclePrelude()` so an active `merging` issue can converge through tracked-PR reconciliation before the broader reconciliation sweep touches unrelated tracked PRs.
- Extended `reconcileTrackedMergedButOpenIssues()` with an optional `onlyIssueNumber` filter and added focused regressions covering the narrowed fast-path and orchestration ordering.
- Verified with the requested focused tests and a local build after installing dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `runOnce()` forced an active `merging` issue to wait for the full `tracked_merged_but_open_issues` sweep, so unrelated tracked PR records could delay or block the active issue from converging to `done` after its PR had already merged.
- What changed: added an active merged fast-path in `src/run-once-cycle-prelude.ts`, taught `reconcileTrackedMergedButOpenIssues()` to optionally restrict work to a single issue record, and added focused regressions in `src/supervisor/supervisor-execution-orchestration.test.ts` and `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Current blocker: none.
- Next exact step: commit the active-merged fast-path change on `codex/issue-971`, then open or update the draft PR if requested.
- Verification gap: none in the requested local scope after rerunning the focused reconciliation/orchestration tests and the build.
- Files touched: `src/recovery-reconciliation.ts`, `src/run-once-cycle-prelude.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is a narrow sequencing fast-path that reuses the existing tracked merged reconciliation logic and only short-circuits the broader prelude once the active issue has already converged to `done`.
- Last focused command: `npm run build`
- Exact failure reproduced: `runOnce()` queried unrelated tracked PR reconciliation targets before the active `merging` issue, so an unrelated tracked PR could block the active merged issue from converging to `done`.
- Commands run: `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm ci`; `npm run build`.
- PR status: none.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
