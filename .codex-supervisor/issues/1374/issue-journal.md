# Issue #1374: Refactor: extract pure post-turn pull-request transition policy from post-turn-pull-request.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1374
- Branch: codex/issue-1374
- Workspace: .
- Journal: .codex-supervisor/issues/1374/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 213b005957753ed4e9c1aceb0e806b42a91d7464
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T01:01:31.214Z

## Latest Codex Summary
- Added a narrow pure-policy test for post-turn local-review transitions, extracted the local-review decision patch into `src/post-turn-pull-request-policy.ts`, and rewired `src/post-turn-pull-request.ts` to keep orchestration and side effects separate while preserving existing integration behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining extraction seam in `post-turn-pull-request.ts` is the pure local-review transition/update policy, not the later tracked-PR lifecycle snapshot which already lives in `src/supervisor/supervisor-lifecycle.ts`.
- What changed: added `src/post-turn-pull-request-policy.test.ts` as a focused reproducer; extracted `derivePostTurnLocalReviewDecision` and `derivePostTurnLocalReviewFailurePatch` into `src/post-turn-pull-request-policy.ts`; replaced the inline local-review state-routing patch logic in `src/post-turn-pull-request.ts` with the new pure helper outputs.
- Current blocker: none.
- Next exact step: commit the extracted pure-policy refactor on `codex/issue-1374`; if another turn continues, consider whether the later post-ready failure-context assembly also deserves a dedicated policy helper.
- Verification gap: none for the issue acceptance checks run locally.
- Files touched: `.codex-supervisor/issues/1374/issue-journal.md`, `src/post-turn-pull-request-policy.test.ts`, `src/post-turn-pull-request-policy.ts`, `src/post-turn-pull-request.ts`.
- Rollback concern: low; the extraction preserves the existing record patch shape and follow-up issue side-effect gate, and the large integration test file stayed green after the change.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
