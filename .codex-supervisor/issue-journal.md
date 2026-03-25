# Issue #974: Reconciliation stall isolation: keep slow unrelated GitHub fetches from delaying active merged-issue convergence

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/974
- Branch: codex/issue-974
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7113d23f46334b956f09389af118b7916f52b36b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T08:30:49.696Z

## Latest Codex Summary
- Isolated active merged-issue convergence from unrelated tracked-PR fetches by widening the prelude fast path in `src/run-once-cycle-prelude.ts` to cover any active issue with a tracked PR, not just `merging`, and added a focused orchestration regression for an active `waiting_ci` issue in `src/supervisor/supervisor-execution-orchestration.test.ts`.
- Local verification passed for `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts src/github/github-transport.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build` after installing missing dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: active merged issues outside the `merging` state were still falling back to the full tracked-merged reconciliation sweep, so a slow unrelated `getPullRequestIfExists()` call could delay convergence even though the active issue already had a tracked merged PR.
- What changed: widened the isolated active reconciliation fast path in `src/run-once-cycle-prelude.ts` from `activeRecord.state === "merging"` to any non-null active record with `pr_number !== null`, and added a focused regression in `src/supervisor/supervisor-execution-orchestration.test.ts` that covers an active `waiting_ci` issue whose merged PR must converge before an unrelated tracked PR is fetched.
- Current blocker: none.
- Next exact step: commit the local fix on `codex/issue-974`, then open or update the draft PR for issue #974 if one is not already present.
- Verification gap: none in the requested local scope after rerunning `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts src/github/github-transport.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build`.
- Files touched: `src/run-once-cycle-prelude.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only affects reconciliation scheduling for the active issue by isolating its tracked-PR convergence ahead of the broader tracked-PR sweep, and leaves underlying GitHub fetch semantics unchanged.
- Last focused command: `npm run build`
- Exact failure reproduced: with active issue #92 in `waiting_ci`, unrelated issue #91 also carrying a tracked PR, and the active PR #192 already merged, `runOnce()` fetched unrelated PR #191 first and threw `unrelated reconciliation touched PR #191 before active merged convergence`.
- Commands run: `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts --test-name-pattern "runOnce converges an active merged waiting_ci issue before unrelated tracked-PR reconciliation work"`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts src/github/github-transport.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm install`; `npm run build`.
- PR status: none yet from this workspace.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
