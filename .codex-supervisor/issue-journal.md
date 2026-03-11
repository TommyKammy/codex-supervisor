# Issue #37: Improve status visibility for local review gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/37
- Branch: codex/issue-37
- Workspace: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37
- Journal: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1
- Last head SHA: f55cae073df88069ef4ca61e230dd5127afa0691
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-11T15:02:30.032Z

## Latest Codex Summary
- Added focused status coverage for local-review gate visibility and updated `status` output to show `gating`, `policy`, `findings`, `max_severity`, and whether the stored review head is `current` or `stale`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The status visibility gap is isolated to `formatDetailedStatus`, which currently emits a terse local-review line without explicit gating or head freshness semantics.
- Primary failure or risk: Full-suite verification still includes an unrelated pre-existing failure in `src/review-role-detector.test.ts` expecting older role detection output.
- Last focused command: `npx tsx --test src/supervisor.test.ts`
- Files changed: `src/supervisor.ts`, `src/supervisor.test.ts`
- Next 1-3 actions:
  1. Review the updated status line against acceptance criteria for compactness.
  2. Commit the focused status formatter change and tests.
  3. Decide whether to open a draft PR from the checkpoint.

### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproduced the issue by adding formatter tests for `block_ready` current-head gating and stale `block_merge` review state.
- Focused verification passed with `npx tsx --test src/supervisor.test.ts` and `npm run build`.
- `npm test -- --test-name-pattern="formatDetailedStatus shows|formatDetailedStatus marks"` still reports unrelated failure: `detectLocalReviewRoles adds prisma specialists for prisma repos`.
