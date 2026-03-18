# Issue #524: Local review abstraction: route verifier turns through the same runner-backed abstraction style

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/524
- Branch: codex/issue-524
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-524
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-524/.codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: ffb6c9f4e39d6b356f271108acd6b71b3e8a0876
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T02:24:56.077Z

## Latest Codex Summary
Verifier turns now use the same injected turn-executor seam as reviewer turns. In [src/local-review/runner.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-524/src/local-review/runner.ts), `runVerifierReview()` accepts `executeTurn?: LocalReviewTurnExecutor` and defaults to `runCodexReviewTurn`, preserving prompt construction, prior-miss loading, verifier guardrails, exit-code degradation, and footer parsing. In [src/local-review/runner.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-524/src/local-review/runner.test.ts), I added the focused regression that proved the verifier path bypassed the contract, then verified it now routes through the injected executor. I also updated [issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-524/.codex-supervisor/issue-journal.md) and committed the checkpoint as `ffb6c9f` (`Route local review verifier through turn executor`).

Verification passed after restoring local dependencies with `npm ci`: `npx tsx --test src/local-review/runner.test.ts`, `npx tsx --test src/local-review/execution.test.ts`, `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts`, and `npm run build`.

Summary: Routed local-review verifier execution through the shared turn executor abstraction and added a focused verifier contract regression test.
State hint: local_review
Blocked reason: none
Tests: `npx tsx --test src/local-review/runner.test.ts`; `npx tsx --test src/local-review/execution.test.ts`; `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts`; `npm run build`
Failure signature: none
Next action: Open or update the draft PR for `codex/issue-524` with commit `ffb6c9f`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: confirmed and fixed; verifier orchestration had bypassed the shared runner-backed contract because `runVerifierReview()` directly invoked the Codex CLI instead of using the injected turn executor style already used by reviewer turns.
- What changed: added a focused verifier regression in `src/local-review/runner.test.ts`, updated `runVerifierReview()` in `src/local-review/runner.ts` to accept `executeTurn?: LocalReviewTurnExecutor` and route verifier execution through `args.executeTurn ?? runCodexReviewTurn` while preserving verifier prompts, guardrail loading, exit-code degradation, and footer parsing, then pushed commit `ffb6c9f` and opened draft PR #527.
- Current blocker: none
- Next exact step: monitor draft PR #527 (`https://github.com/TommyKammy/codex-supervisor/pull/527`) for CI and review feedback, then address any failures or comments.
- Verification gap: none locally after rerunning the focused verifier tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/local-review/runner.ts`, `src/local-review/runner.test.ts`
- Rollback concern: if `runVerifierReview()` is reverted to direct CLI construction, verifier turns will bypass the shared execution contract and local-review orchestration will fork again on tool-specific calling code.
- Last focused command: `npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Added `src/local-review/runner.test.ts` coverage for `runVerifierReview()` using an injected turn executor; the focused repro failed with assertion `0 !== 1` because no verifier request hit the injected contract, yielding failure signature `local-review-verifier-bypasses-runner-contract`.
- 2026-03-18 (JST): Narrow fix: extended `runVerifierReview()` to accept `executeTurn?: LocalReviewTurnExecutor` and route verifier execution through `args.executeTurn ?? runCodexReviewTurn` while preserving verifier prompt generation, relevant prior-miss loading, guardrail loading, and parsed verifier footer semantics.
- 2026-03-18 (JST): `npm run build` failed after the code fix with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain in this worktree.
- 2026-03-18 (JST): Verified with `npx tsx --test src/local-review/runner.test.ts`, `npx tsx --test src/local-review/execution.test.ts`, `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts`, and `npm run build`.
- 2026-03-18 (JST): Pushed `codex/issue-524` to origin and opened draft PR #527: `https://github.com/TommyKammy/codex-supervisor/pull/527`.
