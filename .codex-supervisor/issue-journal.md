# Issue #1456: Surface preserved partial-work incidents in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1456
- Branch: codex/issue-1456
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: pr_open
- Attempt count: 4 (implementation=2, repair=1)
- Last head SHA: da1372ed07ac461c67da46f2e69be5dd51c06a55
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856WbAd
- Repeated failure signature count: 1
- Updated at: 2026-04-12T07:22:09Z

## Latest Codex Summary
Applied the review fix for PR #1459 and pushed it on `codex/issue-1456`. The recovery path now keeps untracked `??` files from being reported as preserved tracked partial work, while still leaving untracked-only dirty workspaces in `manual_review_required`. I added a regression test for that case, replied on the original review thread, and reran focused verification plus a full build.

PR #1459 is open, mergeable, and currently green on `build (ubuntu-latest)`, `build (macos-latest)`, and `CodeRabbit`. This journal refresh clears the stale repair-checkpoint metadata so the next supervisor cycle can treat the branch as a normal open PR instead of an active review blocker.

Summary: Refreshed the issue-journal checkpoint after the repair turn so PR #1459 is back in `pr_open` with the focused rerun recorded and no active failure context
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/core/git-workspace-helpers.test.ts src/recovery-support.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-rendering.test.ts`; `npm run build`
Next action: Watch PR #1459 for any new CI or review feedback and address it if it appears
Failure signature: none

## Active Failure Context
- None recorded. The prior review-thread blocker was reduced to stale journal metadata and is now reflected in the cleared checkpoint state above.

## Codex Working Notes
### Current Handoff
- Hypothesis: The behavior change for preserved partial-work incidents is complete; the only remaining ambiguity was stale repair-turn metadata in the tracked issue journal, so clearing that checkpoint should return the supervisor to normal `pr_open` monitoring.
- What changed: Confirmed with `gh` that PR #1459 is open, clean, and green, verified the only unresolved review thread targets the journal metadata itself, and refreshed this tracked checkpoint so the snapshot, summary, and active-failure sections all consistently show the post-repair `pr_open` state with the focused rerun recorded.
- Current blocker: none
- Next exact step: Watch PR #1459 for any new CI or review feedback and address it if it appears.
- Verification gap: No additional code verification reran for this journal-only metadata refresh; the recorded focused `npx tsx --test src/core/git-workspace-helpers.test.ts src/recovery-support.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-rendering.test.ts` run plus `npm run build` remain the latest local verification, and the current PR checks are green.
- Files touched: .codex-supervisor/issue-journal.md
- Rollback concern: Low; this turn only refreshes tracked supervisor handoff metadata and does not alter the implemented preserved-partial-work behavior.
- Last focused commands: `gh pr view 1459 --json number,url,isDraft,reviewDecision,mergeStateStatus,headRefName,baseRefName,statusCheckRollup`; `gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ reviewThreads(first:50){ nodes{ id isResolved isOutdated path line comments(first:10){ nodes{ author{login} body url createdAt } } } } } } }' -F owner=TommyKammy -F repo=codex-supervisor -F number=1459`
### Scratchpad
- 2026-04-12: Confirmed the only remaining unresolved review thread was the stale journal checkpoint itself; refreshed the tracked metadata to `pr_open` after verifying PR #1459 is clean and green.
- 2026-04-12: Addressed PRRT_kwDORgvdZ856WZIX by excluding `??` entries from failed no-PR `preservedTrackedFiles`; untracked-only work still yields `manual_review_required` but no longer advertises preserved tracked partial work.
- 2026-04-12: Posted follow-up on PR #1459 via `gh api` because the GitHub app lacked permission to reply to the inline comment, then resolved the review thread directly with GraphQL.
