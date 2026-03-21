# Issue #739: Hydration freshness before merge: require a fresh PR read before merge-enabling actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/739
- Branch: codex/issue-739
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 4a27f936a199566f814c9484db9cc521a94e5a64
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T01:27:13Z

## Latest Codex Summary
Implemented the merge-enable freshness guard in [supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-739/src/supervisor/supervisor.ts#L747): `handlePostTurnMergeAndCompletion` now re-reads the PR with `getPullRequest` immediately before `enableAutoMerge`, so the final merge-enabling action uses a fresh authoritative head SHA instead of the carried snapshot. I also added a focused regression in [supervisor-pr-readiness.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-739/src/supervisor/supervisor-pr-readiness.test.ts#L378) that reproduces the stale-head case and proves the refreshed head is the one passed to auto-merge.

I pushed branch `codex/issue-739` to `origin` and opened draft PR [#758](https://github.com/TommyKammy/codex-supervisor/pull/758) (`Require fresh PR read before merge enablement`). GitHub currently reports the PR as `OPEN`, draft, with merge state `UNSTABLE`. The worktree is clean aside from the updated issue journal and the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Pushed the merge-enable freshness checkpoint and opened draft PR #758 for review/CI.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts`; `npx tsx --test src/github/github-pull-request-hydrator.test.ts src/supervisor/supervisor-lifecycle.test.ts`; `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-lifecycle.test.ts src/github/github-pull-request-hydrator.test.ts`; `npm ci`; `npm run build` (note: issue guidance mentions `src/pull-request-state.test.ts`, but that file does not exist in this worktree)
Failure signature: none
Next action: monitor PR #758 checks and address any review or CI feedback if it appears.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the final merge-enable action still trusts the previously carried PR snapshot, so same-number same-branch review/head changes can slip past if `enableAutoMerge` does not force one last authoritative PR hydration read.
- What changed: `Supervisor.handlePostTurnMergeAndCompletion` now re-reads the PR with `getPullRequest` immediately before calling `enableAutoMerge`. Added a focused regression test that passes a stale PR head into merge enablement and proves the fresh head SHA is used instead.
- Current blocker: none
- Next exact step: monitor draft PR #758 and respond to any CI or review feedback.
- Verification gap: the issue guidance references `src/pull-request-state.test.ts`, but that file does not exist in this worktree; I verified the merge-enable freshness path with the focused supervisor readiness suite plus the requested lifecycle/hydrator suites.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`
- Rollback concern: removing the last-moment `getPullRequest` refresh would let `enableAutoMerge` reuse a stale carried PR head and merge-authoritative review facts from an earlier snapshot.
- Last focused command: `gh pr create --draft --base main --head codex/issue-739 --title "Require fresh PR read before merge enablement" --body-file -`
- Last focused failure: none
- Last focused commands:
```bash
git log --oneline --decorate -5
git remote -v
gh pr status
gh pr list --head codex/issue-739 --json number,state,isDraft,title,url,headRefName,baseRefName
git push -u origin codex/issue-739
git diff -- .codex-supervisor/issue-journal.md
gh pr create --draft --base main --head codex/issue-739 --title "Require fresh PR read before merge enablement" --body-file -
git status --short --branch
gh pr view 758 --json number,state,isDraft,title,url,mergeStateStatus,headRefName,baseRefName
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
