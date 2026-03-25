# Issue #971: Post-merge fast-path: converge an active merged issue before unrelated broad reconciliation work

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/971
- Branch: codex/issue-971
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 7fd4bbc26d20f38b6361b32943997df1a91ccc33
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-25T06:12:29.422Z

## Latest Codex Summary
Revalidated the active-merged fast-path checkpoint, pushed `codex/issue-971`, and opened draft PR #985 so the merged-issue convergence fix can move through review without waiting in stale stabilizing recovery.

The implementation remains the same as commit `7fd4bbc` (`Add active merged issue reconciliation fast-path`): it prioritizes the active `merging` issue in `runOnceCyclePrelude()`, reuses `reconcileTrackedMergedButOpenIssues()` with a single-issue filter, and short-circuits broader reconciliation once that active issue reaches `done`. Focused verification passed again with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build`, and the draft PR is https://github.com/TommyKammy/codex-supervisor/pull/985.

Summary: Pushed the active merged-issue fast-path checkpoint and opened draft PR #985 after rerunning the focused tests and build.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Monitor draft PR #985 for review or CI feedback and address any follow-up changes.
Failure signature: stale-stabilizing-no-pr-recovery-loop

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `runOnce()` forced an active `merging` issue to wait for the full `tracked_merged_but_open_issues` sweep, so unrelated tracked PR records could delay or block the active issue from converging to `done` after its PR had already merged.
- What changed: added an active merged fast-path in `src/run-once-cycle-prelude.ts`, taught `reconcileTrackedMergedButOpenIssues()` to optionally restrict work to a single issue record, and added focused regressions in `src/supervisor/supervisor-execution-orchestration.test.ts` and `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Current blocker: none.
- Next exact step: monitor draft PR #985 and address review or CI feedback if it arrives.
- Verification gap: none in the requested local scope after rerunning the focused reconciliation/orchestration tests and the build immediately before opening the draft PR.
- Files touched: `src/recovery-reconciliation.ts`, `src/run-once-cycle-prelude.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is a narrow sequencing fast-path that reuses the existing tracked merged reconciliation logic and only short-circuits the broader prelude once the active issue has already converged to `done`.
- Last focused command: `gh pr create --draft --base main --head codex/issue-971 --title "Issue #971: fast-path active merged issue convergence" ...`
- Exact failure reproduced: `runOnce()` queried unrelated tracked PR reconciliation targets before the active `merging` issue, so an unrelated tracked PR could block the active merged issue from converging to `done`.
- Commands run: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`; `git push -u origin codex/issue-971`; `gh pr create --draft --base main --head codex/issue-971 --title "Issue #971: fast-path active merged issue convergence" ...`.
- PR status: draft PR #985 (`https://github.com/TommyKammy/codex-supervisor/pull/985`).
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
