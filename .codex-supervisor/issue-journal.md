# Issue #972: Reconciliation budgeting: bound tracked-merged-but-open processing per cycle

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/972
- Branch: codex/issue-972
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: abe52fc6081366bde6fd52a87682e31675a65ef6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T06:57:40.311Z

## Latest Codex Summary
Bounded tracked merged-but-open reconciliation in [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts) so each cycle now stops after a default cap of PR-bearing records and leaves the rest untouched for later cycles. The focused regression in [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts) proves that once the per-cycle budget is exhausted, remaining merged records are deferred cleanly instead of being processed in the same pass.

I updated the working notes in [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) and committed the checkpoint as `abe52fc` (`Issue #972: bound tracked merged reconciliation per cycle`). I also had to run `npm ci` first because `npm run build` initially failed with `tsc: not found` due missing `node_modules/`.

Summary: Added a focused failing regression, bounded tracked-merged-but-open reconciliation per cycle, updated the issue journal, and committed the fix as `abe52fc`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm ci`; `npm run build`
Next action: push `codex/issue-972` and open/update the draft PR for issue #972
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileTrackedMergedButOpenIssues()` iterated every tracked PR-bearing record in a single pass, so one large backlog of merged-but-open records could monopolize a reconciliation cycle and delay the rest of the supervisor loop.
- What changed: added a focused regression in `src/supervisor/supervisor-recovery-reconciliation.test.ts`, then bounded `reconcileTrackedMergedButOpenIssues()` in `src/recovery-reconciliation.ts` with a default per-cycle processed-record cap while leaving remaining records untouched for later cycles.
- Current blocker: none.
- Next exact step: monitor draft PR #986 and address CI or review feedback if it arrives.
- Verification gap: none in the requested local scope after rerunning the focused prelude/reconciliation tests and `npm run build`.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only stops the tracked merged-but-open sweep after a bounded number of PR-bearing records and leaves unprocessed records unchanged for later cycles.
- Last focused command: `gh pr create --draft --base main --head codex/issue-972 --title "Issue #972: bound tracked merged reconciliation per cycle" ...`
- Exact failure reproduced: `reconcileTrackedMergedButOpenIssues()` looked up both PR #191 and PR #192 in one cycle even when only one record should have been processed before deferring the rest.
- Commands run: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm ci`; `npm run build`; `git push -u origin codex/issue-972`; `gh pr create --draft --base main --head codex/issue-972 --title "Issue #972: bound tracked merged reconciliation per cycle" ...`.
- PR status: draft PR #986 (`https://github.com/TommyKammy/codex-supervisor/pull/986`).
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
