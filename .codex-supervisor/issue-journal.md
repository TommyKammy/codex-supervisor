# Issue #1494: Current publication can still be blocked by unrelated sparse issue journal in active worktree

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1494
- Branch: codex/issue-1494
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: be9b36a9023b2178e62aaf46d2297c05ead7db19
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T01:50:51.960Z

## Latest Codex Summary
- Reproduced tracked ready-promotion blocking on a sparse-omitted cross-issue journal path and fixed publication persistence to ignore rewritten journal paths that are not present in the active sparse worktree.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: tracked PR ready-promotion still tried to persist every rewritten supervisor-owned journal path, including tracked cross-issue journals omitted by sparse checkout, so `git add` turned an unrelated omitted journal into a false `workstation-local-path-hygiene-failed` blocker.
- What changed: added a focused sparse regression for `handlePostTurnPullRequestTransitionsPhase`; filtered rewritten journal persistence paths down to files present in the active worktree before commit/push in the tracked ready-promotion path and the shared publication callers.
- Current blocker: none.
- Next exact step: review the final diff and continue with PR/update flow from this checkpoint.
- Verification gap: full `npm test -- src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts` still runs unrelated baseline failures in this worktree, so verification stayed focused on the targeted node test-name runs plus `npm run build`.
- Files touched: .codex-supervisor/issue-journal.md; src/core/workspace.ts; src/post-turn-pull-request.ts; src/post-turn-pull-request.test.ts; src/turn-execution-publication-gate.ts; src/run-once-turn-execution.ts
- Rollback concern: low; the change only skips commit attempts for rewritten journal paths absent from the active sparse worktree and leaves current in-scope hygiene blockers unchanged.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Focused verification:
- `node --test --import tsx --test-name-pattern "handlePostTurnPullRequestTransitionsPhase tolerates sparse-omitted cross-issue journal rewrites during ready promotion" src/post-turn-pull-request.test.ts`
- `node --test --import tsx --test-name-pattern "handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when workstation-local path hygiene fails" src/post-turn-pull-request.test.ts`
- `node --test --import tsx --test-name-pattern "applyCodexTurnPublicationGate tolerates tracked cross-issue journals omitted by sparse checkout" src/turn-execution-publication-gate.test.ts`
- `npm run build`
