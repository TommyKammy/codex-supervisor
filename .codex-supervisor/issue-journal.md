# Issue #37: Improve status visibility for local review gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/37
- Branch: codex/issue-37
- Workspace: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37
- Journal: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/.codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 4
- Last head SHA: e51def2c17d1f2accddeeb10eb068a27fc8c4ae8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-11T15:14:42.785Z

## Latest Codex Summary
Promoted PR [#43](https://github.com/TommyKammy/codex-supervisor/pull/43) from draft to ready for review after confirming the branch was stable, checks were green, and no further code changes were pending. I updated the durable handoff in [.codex-supervisor/issue-journal.md](/Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/.codex-supervisor/issue-journal.md) so the next turn sees the correct PR state.

Summary: Marked PR #43 ready for review and synced the issue journal to the new PR-open state.
State hint: pr_open
Blocked reason: none
Tests: No new code verification this turn; used `gh pr ready 43` after prior focused verification and passing CI checks
Failure signature: none
Next action: Wait for review feedback on PR #43 and address any comments with narrow follow-up changes.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The implementation is ready for external review; further edits should only be review-driven.
- Primary failure or risk: No issue-specific failure is active; the only known verification noise is the unrelated pre-existing `src/review-role-detector.test.ts` expectation drift.
- Last focused command: `gh pr ready 43`
- Files changed: `src/supervisor.ts`, `src/supervisor.test.ts`
- Next 1-3 actions:
  1. Wait for review feedback on PR #43.
  2. If feedback arrives, keep any follow-up changes narrowly scoped to status wording or coverage.
  3. Re-run focused verification and update the PR branch after review-driven edits.

### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproduced the issue by adding formatter tests for `block_ready` current-head gating and stale `block_merge` review state.
- Focused verification passed with `npx tsx --test src/supervisor.test.ts` and `npm run build`.
- Reviewed the rendered formatter output directly with `npx tsx -e` and confirmed the local-review line stays compact in terminal form.
- Checked live PR state with `gh pr view 43 --json ...`: draft is still true, merge state is CLEAN, and there are no comments or reviews yet.
- Promoted PR #43 to ready for review with `gh pr ready 43`.
- `npm test -- --test-name-pattern="formatDetailedStatus shows|formatDetailedStatus marks"` still reports unrelated failure: `detectLocalReviewRoles adds prisma specialists for prisma repos`.
- Checkpoint commit: `d6f9093` (`Improve local review gate status output`).
- Draft PR opened: `#43` <https://github.com/TommyKammy/codex-supervisor/pull/43>.
