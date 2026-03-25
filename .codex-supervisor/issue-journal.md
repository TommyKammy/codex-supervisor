# Issue #972: Reconciliation budgeting: bound tracked-merged-but-open processing per cycle

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/972
- Branch: codex/issue-972
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9235e98fa910f5b0b8970efef3270f9dcbe48bb0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T06:38:49.290Z

## Latest Codex Summary
- Added a focused regression proving tracked merged-but-open reconciliation must stop after a bounded amount of work in one cycle and defer remaining records.
- Bounded `reconcileTrackedMergedButOpenIssues()` with a default per-cycle record cap and an overrideable test option, preserving existing convergence semantics for processed records.
- Verified with the requested focused tests and a successful local build after restoring missing `node_modules/` via `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileTrackedMergedButOpenIssues()` iterated every tracked PR-bearing record in a single pass, so one large backlog of merged-but-open records could monopolize a reconciliation cycle and delay the rest of the supervisor loop.
- What changed: added a focused regression in `src/supervisor/supervisor-recovery-reconciliation.test.ts`, then bounded `reconcileTrackedMergedButOpenIssues()` in `src/recovery-reconciliation.ts` with a default per-cycle processed-record cap while leaving remaining records untouched for later cycles.
- Current blocker: none.
- Next exact step: commit the bounded reconciliation checkpoint on `codex/issue-972`, then open or update the draft PR for issue #972.
- Verification gap: none in the requested local scope after rerunning the focused prelude/reconciliation tests and `npm run build`.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only stops the tracked merged-but-open sweep after a bounded number of PR-bearing records and leaves unprocessed records unchanged for later cycles.
- Last focused command: `npm run build`
- Exact failure reproduced: `reconcileTrackedMergedButOpenIssues()` looked up both PR #191 and PR #192 in one cycle even when only one record should have been processed before deferring the rest.
- Commands run: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm ci`; `npm run build`.
- PR status: none.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
