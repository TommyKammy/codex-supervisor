# Issue #739: Hydration freshness before merge: require a fresh PR read before merge-enabling actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/739
- Branch: codex/issue-739
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: ca7b9f1e91da9782388377afa995e045d04df740
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-21T01:40:28Z

## Latest Codex Summary
Implemented the merge-enable freshness guard in [supervisor.ts](src/supervisor/supervisor.ts#L747): `handlePostTurnMergeAndCompletion` now re-reads the PR with `getPullRequest` immediately before `enableAutoMerge`, so the final merge-enabling action uses a fresh authoritative head SHA instead of the carried snapshot. I also added a focused regression in [supervisor-pr-readiness.test.ts](src/supervisor/supervisor-pr-readiness.test.ts#L378) that reproduces the stale-head case and proves the refreshed head is the one passed to auto-merge.

PR [#758](https://github.com/TommyKammy/codex-supervisor/pull/758) is open on `codex/issue-739` and is no longer draft. This turn narrowed to the review-reported machine-local links in the journal, and I pushed the journal-only fix as `ca7b9f1`.

The implementation checkpoint remains `4a27f93` for the actual merge-freshness change, with prior focused verification already recorded in the journal. GitHub currently reports PR `#758` as `OPEN`, not draft, with merge state `UNSTABLE`.

Summary: Pushed `ca7b9f1` to replace the journal's machine-local file links with repository-relative links for PR #758 review feedback.
State hint: addressing_review
Blocked reason: none
Tests: Not rerun this turn; journal-only review fix. Prior verified commands remain `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-lifecycle.test.ts src/github/github-pull-request-hydrator.test.ts` and `npm run build`
Failure signature: none
Next action: Refresh PR #758 review status and address any remaining review or CI feedback

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/758#discussion_r2968648846
- Details:
  - CodeRabbit thread `PRRT_kwDORgvdZ8511-fE` flagged the old Latest Codex Summary entry for using machine-local links to `src/supervisor/supervisor.ts#L747` and `src/supervisor/supervisor-pr-readiness.test.ts#L378`; fix commit `ca7b9f1` replaces them with repository-relative links and is now pushed to the PR branch.

## Codex Working Notes
### Current Handoff
- Hypothesis: the final merge-enable action still trusts the previously carried PR snapshot, so same-number same-branch review/head changes can slip past if `enableAutoMerge` does not force one last authoritative PR hydration read.
- What changed: `Supervisor.handlePostTurnMergeAndCompletion` now re-reads the PR with `getPullRequest` immediately before calling `enableAutoMerge`. Added a focused regression test that passes a stale PR head into merge enablement and proves the fresh head SHA is used instead.
- Current blocker: none
- Next exact step: recheck PR #758 review status after pushed fix `ca7b9f1` and respond to any remaining review or CI feedback.
- Verification gap: the issue guidance references `src/pull-request-state.test.ts`, but that file does not exist in this worktree; I verified the merge-enable freshness path with the focused supervisor readiness suite plus the requested lifecycle/hydrator suites.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`
- Rollback concern: removing the last-moment `getPullRequest` refresh would let `enableAutoMerge` reuse a stale carried PR head and merge-authoritative review facts from an earlier snapshot.
- Last focused command: `git push origin codex/issue-739`
- Last focused failure: none
- Last focused commands:
```bash
git diff -- .codex-supervisor/issue-journal.md
nl -ba .codex-supervisor/issue-journal.md | sed -n '1,120p'
rg -n '/home/tommy/Dev/codex-supervisor-self-worktrees/issue-739' .codex-supervisor/issue-journal.md
git show HEAD:.codex-supervisor/issue-journal.md | sed -n '1,120p'
git status --short --branch
git add .codex-supervisor/issue-journal.md
git commit -m "Fix journal links for review thread"
git push origin codex/issue-739
gh pr view 758 --json number,state,isDraft,mergeStateStatus,reviewDecision,url,headRefOid
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
