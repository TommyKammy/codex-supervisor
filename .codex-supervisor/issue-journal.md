# Issue #954: Refreshed snapshot propagation: require downstream state, actions, and metrics to use the latest source-of-truth snapshot

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/954
- Branch: codex/issue-954
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 3 (implementation=3, repair=0)
- Last head SHA: 794f64da7412bdb82c35eb66b9241a47f843a51b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T23:22:53.207Z

## Latest Codex Summary
- Reproduced a refreshed-snapshot propagation gap in `handlePostTurnMergeAndCompletion`: after a fresh merge-readiness snapshot downgraded a stale `ready_to_merge` record to `blocked`, the state transition kept the stale `last_error` instead of the refreshed failure context/signature. Tightened `src/supervisor/supervisor-pr-readiness.test.ts` to assert the refreshed local-review blocker details, then updated `src/supervisor/supervisor.ts` to propagate the refreshed failure context, last error, and failure signature through the post-refresh state write.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: one refreshed-snapshot path still used stale downstream state fields after recomputing merge readiness, specifically the post-ready-to-merge refresh path that could downgrade to `blocked` without carrying the refreshed failure context forward.
- What changed: tightened `src/supervisor/supervisor-pr-readiness.test.ts` so the stale-ready-to-merge regression asserts refreshed local-review blocker details; updated `handlePostTurnMergeAndCompletion()` in `src/supervisor/supervisor.ts` to propagate refreshed failure context, `last_error`, and failure-signature tracking when a refreshed snapshot downgrades the PR after rechecking merge readiness.
- Current blocker: none.
- Next exact step: commit the issue-954 fix, then open or update the draft PR from `codex/issue-954`.
- Verification gap: none in the requested scope; `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts`, `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts`, and `npm run build` passed after `npm ci`.
- Files touched: `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the runtime change only affects refreshed post-merge-readiness downgrades and aligns persisted failure fields with the already-computed refreshed lifecycle snapshot.
- Last focused command: `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts && npm run build`
- PR status: no PR opened from `codex/issue-954` yet in this turn.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
