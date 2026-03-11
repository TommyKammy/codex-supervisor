# Issue #37: Improve status visibility for local review gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/37
- Branch: codex/issue-37
- Workspace: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37
- Journal: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/.codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 3
- Last head SHA: 75bbf6ae5940c2de83be2a337d0352fe4123cfe3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-11T15:11:27.110Z

## Latest Codex Summary
Reviewed the draft PR state and validated the terminal shape of the new `status` output directly. The local-review line is compact and now answers the acceptance questions in one row: gating state, active policy, finding count, max severity, and whether the stored review is current or stale in [src/supervisor.ts](/Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/src/supervisor.ts). No further code changes were needed.

I updated the durable handoff in [.codex-supervisor/issue-journal.md](/Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/.codex-supervisor/issue-journal.md), committed it as `75bbf6a`, and pushed the branch so PR [#43](https://github.com/TommyKammy/codex-supervisor/pull/43) is current.

Summary: Validated the draft PR output shape, confirmed the status line is compact and sufficient, and pushed an updated issue-journal handoff.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx -e 'import { formatDetailedStatus } from "./src/supervisor.ts"; ...'` to inspect rendered status output; no new code-path tests added this turn
Failure signature: none
Next action: Wait for review on draft PR #43 and only make narrowly scoped follow-up changes if reviewers want different status wording or fields.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: No further code changes are needed unless PR review asks for different wording, because the current status line already satisfies the acceptance criteria and reads cleanly in terminal form.
- Primary failure or risk: No issue-specific failure is active; the only known verification noise is the unrelated pre-existing `src/review-role-detector.test.ts` expectation drift.
- Last focused command: `gh pr view 43 --json isDraft,reviewDecision,mergeStateStatus,comments,reviews,latestReviews`
- Files changed: `src/supervisor.ts`, `src/supervisor.test.ts`
- Next 1-3 actions:
  1. Wait for review on draft PR #43.
  2. If feedback arrives, keep any follow-up changes narrowly scoped to status wording or coverage.
  3. Re-run focused verification and update the PR branch after review-driven edits.

### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproduced the issue by adding formatter tests for `block_ready` current-head gating and stale `block_merge` review state.
- Focused verification passed with `npx tsx --test src/supervisor.test.ts` and `npm run build`.
- Reviewed the rendered formatter output directly with `npx tsx -e` and confirmed the local-review line stays compact in terminal form.
- Checked live PR state with `gh pr view 43 --json ...`: draft is still true, merge state is CLEAN, and there are no comments or reviews yet.
- `npm test -- --test-name-pattern="formatDetailedStatus shows|formatDetailedStatus marks"` still reports unrelated failure: `detectLocalReviewRoles adds prisma specialists for prisma repos`.
- Checkpoint commit: `d6f9093` (`Improve local review gate status output`).
- Draft PR opened: `#43` <https://github.com/TommyKammy/codex-supervisor/pull/43>.
