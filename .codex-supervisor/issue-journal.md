# Issue #1312: [codex] Add an opt-in current-head local review gate for tracked codex PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1312
- Branch: codex/issue-1312
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d8279549ba31dee66d7768902d6306f401482b87
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-06T22:00:18.819Z

## Latest Codex Summary
- Added an opt-in `trackedPrCurrentHeadLocalReviewRequired` gate that blocks tracked PR ready/merge progression until local review has run on the current PR head, while preserving existing post-review policy behavior once the head is current.
- Added focused regression coverage for rerun triggering, tracked-PR state inference, pre-merge pending diagnostics, ready-PR transition handling, and active status rendering.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: tracked PRs only re-ran or gated local review according to `localReviewPolicy`, so ready PR head updates under `advisory` or `block_ready` could progress without a fresh current-head local review.
- What changed: introduced `trackedPrCurrentHeadLocalReviewRequired` in config parsing/examples; extended `shouldRunLocalReview`, `localReviewBlocksReady`, and `localReviewBlocksMerge` to enforce current-head freshness when enabled; added focused tests plus status/pre-merge diagnostic coverage; documented the new knob.
- Current blocker: none.
- Next exact step: optionally commit the focused implementation slice and open/update the draft PR if the supervisor wants a checkpoint.
- Verification gap: none from local reproduction; broader full-suite verification was not run beyond the issue-targeted tests plus `npm run build`.
- Files touched: `src/core/types.ts`, `src/core/config.ts`, `src/local-review/index.ts`, `src/review-handling.ts`, `src/local-review/index.test.ts`, `src/review-handling.test.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`, `src/supervisor/supervisor-pre-merge-evaluation.test.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/setup-config-preview.ts`, `supervisor.config.example.json`, `docs/configuration.md`, `docs/local-review.md`, `docs/examples/atlaspm.md`, `docs/examples/atlaspm.supervisor.config.example.json`.
- Rollback concern: low; the new behavior is fully opt-in and defaults to `false`, so existing repos stay on current semantics unless they enable the gate.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
