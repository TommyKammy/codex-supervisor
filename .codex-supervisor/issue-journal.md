# Issue #524: Local review abstraction: route verifier turns through the same runner-backed abstraction style

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/524
- Branch: codex/issue-524
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-524
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-524/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3023c47b9d7e95d992e2d9a3e2ab1d80a049647d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T02:15:23.845Z

## Latest Codex Summary
- Verifier turns now execute through the same injected local-review turn contract as reviewer turns, with the default Codex CLI implementation preserved behind that seam.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: verifier orchestration still bypasses the shared runner-backed contract because `runVerifierReview()` directly invokes the Codex CLI instead of using the injected turn executor style already used by reviewer turns.
- What changed: added a focused verifier regression in `src/local-review/runner.test.ts`, then updated `runVerifierReview()` in `src/local-review/runner.ts` to accept `executeTurn?: LocalReviewTurnExecutor` and route verifier execution through `args.executeTurn ?? runCodexReviewTurn` while preserving verifier prompts, guardrail loading, exit-code degradation, and footer parsing.
- Current blocker: none
- Next exact step: commit the verifier-contract checkpoint on `codex/issue-524` and open or update a draft PR if one is not already present.
- Verification gap: none locally after rerunning the focused verifier tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/local-review/runner.ts`, `src/local-review/runner.test.ts`
- Rollback concern: if `runVerifierReview()` is reverted to direct CLI construction, verifier turns will bypass the shared execution contract and local-review orchestration will fork again on tool-specific calling code.
- Last focused command: `npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Added `src/local-review/runner.test.ts` coverage for `runVerifierReview()` using an injected turn executor; the focused repro failed with assertion `0 !== 1` because no verifier request hit the injected contract, yielding failure signature `local-review-verifier-bypasses-runner-contract`.
- 2026-03-18 (JST): Narrow fix: extended `runVerifierReview()` to accept `executeTurn?: LocalReviewTurnExecutor` and route verifier execution through `args.executeTurn ?? runCodexReviewTurn` while preserving verifier prompt generation, relevant prior-miss loading, guardrail loading, and parsed verifier footer semantics.
- 2026-03-18 (JST): `npm run build` failed after the code fix with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain in this worktree.
- 2026-03-18 (JST): Verified with `npx tsx --test src/local-review/runner.test.ts`, `npx tsx --test src/local-review/execution.test.ts`, `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts`, and `npm run build`.
