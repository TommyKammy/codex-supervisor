# Issue #973: Reconciliation resume: preserve tracked-merged-but-open progress across cycles

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/973
- Branch: codex/issue-973
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: bd8c38915038f07bb14d95f5187550f5c2e03606
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T07:45:18.650Z

## Latest Codex Summary
Implemented tracked-merged-but-open resume persistence in commit `bd8c389` and opened draft PR #987.

The fix adds an internal `reconciliation_state.tracked_merged_but_open_last_processed_issue_number` cursor, persists it through JSON and SQLite state backends, and uses it to rotate `reconcileTrackedMergedButOpenIssues()` so bounded sweeps resume from the next tracked PR-bearing record on the next cycle. I added a focused two-cycle regression for the resume behavior plus state-store round-trip tests for the persisted cursor, and updated the issue journal working notes.

Summary: Persisted tracked merged-but-open reconciliation progress across cycles, added focused resume regressions plus state persistence tests, pushed `codex/issue-973`, and opened draft PR #987.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern "resumes from persisted progress in the next cycle"`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern "resumes from persisted progress in the next cycle|stops after the per-cycle budget and defers remaining records"`; `npx tsx --test src/core/state-store.test.ts --test-name-pattern "tracked merged reconciliation resume progress"`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/core/state-store.test.ts --test-name-pattern "tracked merged reconciliation resume progress|resumes from persisted progress in the next cycle|runOnceCyclePrelude"`; `npm ci`; `npm run build`
Next action: monitor draft PR #987 and address CI or review feedback if it arrives
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded tracked-merged-but-open reconciliation forgot its place whenever a cycle processed only still-open tracked PRs, because no record mutated and no resume cursor was persisted.
- What changed: added a focused two-cycle regression in `src/supervisor/supervisor-recovery-reconciliation.test.ts`; persisted `reconciliation_state.tracked_merged_but_open_last_processed_issue_number` in `src/core/types.ts` and `src/core/state-store.ts`; taught `reconcileTrackedMergedButOpenIssues()` in `src/recovery-reconciliation.ts` to rotate the next sweep from the last processed tracked issue and clear the cursor after a full pass; pushed `codex/issue-973`; and opened draft PR #987.
- Current blocker: none.
- Next exact step: monitor draft PR #987 and address CI or review feedback if it arrives.
- Verification gap: none in the requested local scope after rerunning the focused reconciliation/prelude tests, the state-store resume persistence tests, and `npm run build`.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/core/state-store.ts`, `src/core/state-store.test.ts`, `src/core/types.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only adds an internal reconciliation cursor and uses it to resume the bounded tracked merged-but-open sweep without changing recovery semantics for the records themselves.
- Last focused command: `gh pr create --draft --base main --head codex/issue-973 --title "Issue #973: preserve tracked merged reconciliation progress" ...`
- Exact failure reproduced: with `maxRecords=1`, cycle 1 looked up tracked PR #191, observed it still open, saved nothing, and cycle 2 looked up #191 again instead of resuming at tracked PR #192.
- Commands run: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern "resumes from persisted progress in the next cycle"`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts --test-name-pattern "resumes from persisted progress in the next cycle|stops after the per-cycle budget and defers remaining records"`; `npx tsx --test src/core/state-store.test.ts --test-name-pattern "tracked merged reconciliation resume progress"`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/core/state-store.test.ts --test-name-pattern "tracked merged reconciliation resume progress|resumes from persisted progress in the next cycle|runOnceCyclePrelude"`; `npm ci`; `npm run build`; `git push -u origin codex/issue-973`; `gh pr create --draft --base main --head codex/issue-973 --title "Issue #973: preserve tracked merged reconciliation progress" ...`.
- PR status: draft PR #987 (`https://github.com/TommyKammy/codex-supervisor/pull/987`).
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
