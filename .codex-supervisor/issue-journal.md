# Issue #1497: Sparse-present cross-issue journals can still block publication after #1496

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1497
- Branch: codex/issue-1497
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 60ad4340d05398523e4ed9f923cebf76bdd412c7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T02:43:52Z

## Latest Codex Summary
- Hardened sparse publication filtering to require both on-disk presence and successful `git add --dry-run` in the active worktree before journal normalization paths are considered publishable.
- Added regression coverage for sparse-present cross-issue journals in both draft publication and tracked PR ready-promotion flows.
- Verified the targeted publication tests and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Sparse-present cross-issue journals were slipping through because publication only checked `existsSync`, not whether the current sparse worktree could update the index for that path.
- What changed: `filterPresentTrackedFilePaths(...)` is now async and only returns paths that both exist and pass `git add --dry-run -- <path>`; updated all publication callers to await it; added sparse-present regression tests for `applyCodexTurnPublicationGate(...)` and `handlePostTurnPullRequestTransitionsPhase(...)`.
- Current blocker: none.
- Next exact step: review diff and create a checkpoint commit on `codex/issue-1497`.
- Verification gap: none for the scoped issue verification (`node --test --import tsx src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts`, `npm run build`).
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/workspace.ts`, `src/turn-execution-publication-gate.ts`, `src/post-turn-pull-request.ts`, `src/run-once-turn-execution.ts`, `src/turn-execution-publication-gate.test.ts`, `src/post-turn-pull-request.test.ts`.
- Rollback concern: reverting the async filter requires restoring all three await call sites together or TypeScript/build breaks.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
