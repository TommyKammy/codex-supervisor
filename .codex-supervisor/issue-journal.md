# Issue #918: Final evaluation gate: block merge completion until the pre-merge assessment resolves cleanly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/918
- Branch: codex/issue-918
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 873cd821c999548049b625b77790b79995976ec1
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852TB7D
- Repeated failure signature count: 1
- Updated at: 2026-03-24T03:30:09Z

## Latest Codex Summary
Verified the remaining CodeRabbit finding on PR `#933` is still valid on this branch: `handlePostTurnMergeAndCompletion()` refreshed the PR but only rechecked `localReviewBlocksMerge()`, so a PR that became draft or otherwise non-ready could still reach `enableAutoMerge()`. I replaced that ad hoc check with a refreshed lifecycle snapshot and full `inferStateFromPullRequest()` re-evaluation before auto-merge.

Added regression coverage for the two refreshed non-ready cases that matter here: a changed head now falls back to `stabilizing`, and a draft refresh falls back to `draft_pr` instead of enabling auto-merge. Focused readiness/lifecycle tests and `npm run build` all pass locally.

Summary: Rechecked the remaining PR #933 merge-gate review finding, fixed the refreshed readiness hole locally, and added regression coverage
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts`; `npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-lifecycle.test.ts`; `npm run build`
Next action: Commit and push the refreshed merge-gate fix to PR `#933`, then confirm the remaining review thread can be resolved cleanly
Failure signature: PRRT_kwDORgvdZ852TB7D

## Active Failure Context
- Category: review
- Summary: Remaining automated review finding reproduced locally and fixed; GitHub still needs the branch update before the thread can be cleared.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/933#discussion_r2978749108
- Details:
  - `src/supervisor/supervisor.ts` now reloads the full open-PR snapshot, re-derives the lifecycle with `derivePullRequestLifecycleSnapshot()`, and only calls `enableAutoMerge()` when the refreshed lifecycle state is still `ready_to_merge`.
  - `src/supervisor/supervisor-pr-readiness.test.ts` now covers the refreshed draft regression and the refreshed head-change fallback so merge enablement cannot race past a non-ready PR.

## Codex Working Notes
### Current Handoff
- Hypothesis: the last open PR `#933` review thread is fixed by re-running full lifecycle inference on the refreshed PR snapshot before auto-merge enablement.
- What changed: replaced the merge-time `localReviewBlocksMerge()` recheck with a refreshed `derivePullRequestLifecycleSnapshot()` pass in `handlePostTurnMergeAndCompletion`; when the refreshed PR is no longer `ready_to_merge`, the supervisor now persists the inferred state (`stabilizing`, `draft_pr`, `blocked`, etc.) instead of enabling auto-merge; added regression coverage for refreshed head changes and refreshed draft PRs.
- Current blocker: none
- Next exact step: commit and push this branch update, then confirm PR `#933` no longer offers the merge-time readiness thread as an open blocker.
- Verification gap: none for the touched path; refreshed readiness, lifecycle inference, and build all pass locally.
- Files touched: `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: moderate; reverting would reopen the merge-time race that can enable auto-merge after the PR becomes draft or otherwise leaves `ready_to_merge`.
- Last focused command: `npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-lifecycle.test.ts`
- Last focused failure: none
- Draft PR: `#933` https://github.com/TommyKammy/codex-supervisor/pull/933
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-918/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-918/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
sed -n '720,860p' src/supervisor/supervisor.ts
sed -n '569,730p' src/pull-request-state.ts
sed -n '480,700p' src/supervisor/supervisor-pr-readiness.test.ts
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts
npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-lifecycle.test.ts
npm run build
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
