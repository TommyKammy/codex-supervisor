# Issue #973: Reconciliation resume: preserve tracked-merged-but-open progress across cycles

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/973
- Branch: codex/issue-973
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 93251eaae155c473e64fb0a73e5db69afab3deb4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T07:25:22.101Z

## Latest Codex Summary
- Added persisted tracked-merged-but-open reconciliation resume progress so bounded sweeps can continue from the prior cursor instead of restarting at the first tracked PR-bearing record every cycle. Focused regressions now cover both the cross-cycle resume behavior in `src/supervisor/supervisor-recovery-reconciliation.test.ts` and JSON/SQLite state persistence in `src/core/state-store.test.ts`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded tracked-merged-but-open reconciliation forgot its place whenever a cycle processed only still-open tracked PRs, because no record mutated and no resume cursor was persisted.
- What changed: added a focused two-cycle regression in `src/supervisor/supervisor-recovery-reconciliation.test.ts`; persisted `reconciliation_state.tracked_merged_but_open_last_processed_issue_number` in `src/core/types.ts` and `src/core/state-store.ts`; and taught `reconcileTrackedMergedButOpenIssues()` in `src/recovery-reconciliation.ts` to rotate the next sweep from the last processed tracked issue and clear the cursor after a full pass.
- Current blocker: none.
- Next exact step: commit the checkpoint on `codex/issue-973`, then open or update the draft PR for issue #973.
- Verification gap: none in the requested local scope after rerunning the focused reconciliation/prelude tests, the state-store resume persistence tests, and `npm run build`.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/core/state-store.ts`, `src/core/state-store.test.ts`, `src/core/types.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only adds an internal reconciliation cursor and uses it to resume the bounded tracked merged-but-open sweep without changing recovery semantics for the records themselves.
- Last focused command: `npm run build`
- Exact failure reproduced: with `maxRecords=1`, cycle 1 looked up tracked PR #191, observed it still open, saved nothing, and cycle 2 looked up #191 again instead of resuming at tracked PR #192.
- Commands run: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern "resumes from persisted progress in the next cycle"`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern "resumes from persisted progress in the next cycle|stops after the per-cycle budget and defers remaining records"`; `npx tsx --test src/core/state-store.test.ts --test-name-pattern "tracked merged reconciliation resume progress"`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/core/state-store.test.ts --test-name-pattern "tracked merged reconciliation resume progress|resumes from persisted progress in the next cycle|runOnceCyclePrelude"`; `npm ci`; `npm run build`; `npm run build`.
- PR status: none.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
