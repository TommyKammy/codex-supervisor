# Issue #523: Local review abstraction: route reviewer turns through a runner-backed execution contract

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/523
- Branch: codex/issue-523
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-523
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-523/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e8ccfc973166887dfa74db0339ed4e1cc396b526
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T01:58:26.690Z

## Latest Codex Summary
- Reviewer turns now execute through an injected local-review turn contract, with the default Codex CLI implementation preserved behind that seam.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: reviewer orchestration is still tightly coupled to direct Codex CLI invocation inside `runRoleReview()`, so reviewer turns cannot be swapped to a runner-backed contract without changing orchestration code.
- What changed: added `LocalReviewTurnRequest`/`LocalReviewTurnResult` plus `LocalReviewTurnExecutor` in `src/local-review/runner.ts`, updated `runRoleReview()` to route reviewer execution through the injected executor while keeping the default Codex-backed path and footer parsing unchanged, and added a focused regression in `src/local-review/runner.test.ts`.
- Current blocker: none
- Next exact step: commit the reviewer-contract checkpoint on `codex/issue-523` and open or update a draft PR if one is not already present.
- Verification gap: none locally after rerunning the focused reviewer tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/local-review/runner.ts`, `src/local-review/runner.test.ts`
- Rollback concern: if `runRoleReview()` is reverted to direct CLI construction, reviewer turns will bypass the injected execution contract and future runner abstractions will need orchestration changes again.
- Last focused command: `npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Added `src/local-review/runner.test.ts` to prove `runRoleReview()` should use an injected reviewer-turn executor; the focused repro failed with `spawn /usr/bin/codex ENOENT`, yielding failure signature `local-review-reviewer-bypasses-runner-contract`.
- 2026-03-18 (JST): Narrow fix: introduced `LocalReviewTurnRequest`, `LocalReviewTurnResult`, and `LocalReviewTurnExecutor`, then routed `runRoleReview()` through `args.executeTurn ?? runCodexReviewTurn` while preserving the existing prompt and footer parsing behavior.
- 2026-03-18 (JST): Verified with `npx tsx --test src/local-review/runner.test.ts`, `npx tsx --test src/local-review/execution.test.ts`, `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts`, and `npm run build`.
- 2026-03-18 (JST): `npm run build` initially failed in this worktree with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
