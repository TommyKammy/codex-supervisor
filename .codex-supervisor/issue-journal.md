# Issue #723: Remote branch restore: recover missing local issue branches from origin before bootstrapping from default

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/723
- Branch: codex/issue-723
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 5 (implementation=5, repair=0)
- Last head SHA: 9f34abe50050947637fda3d0a80f569582c46a30
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 1
- Updated at: 2026-03-20T19:21:47Z

## Latest Codex Summary
Issue #723 remains already implemented on `origin/main` in [workspace.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/src/core/workspace.ts#L91) with the expected local -> remote -> default restore precedence, and the focused coverage is still in [workspace.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/src/core/workspace.test.ts#L95). I reran the requested verification after publishing the branch and it passed.

I pushed `codex/issue-723` to `origin/codex/issue-723`, opened draft PR [#748](https://github.com/TommyKammy/codex-supervisor/pull/748), and kept the branch scoped to the journal-only checkpoint because the product behavior already shipped in `Remote branch discovery before bootstrap (#747)`. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` artifact, which I left untouched.

Summary: Re-verified #723 as already shipped on `origin/main`, pushed `codex/issue-723`, and opened draft PR #748 for the journal-only checkpoint.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts`; `npm run build`
Failure signature: none
Next action: Decide whether to merge or close draft PR `#748` as a journal-only handoff for work already shipped in PR `#747`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: No product-code change is required for #723 in this worktree because the requested local -> remote -> bootstrap restore behavior is already implemented on `origin/main`; the remaining useful work is keeping the issue branch attached to a remote and PR so the supervisor has a stable checkpoint instead of re-entering no-PR recovery.
- What changed: re-read the required memory files and journal, confirmed the branch only differed from `origin/main` by the journal checkpoint commit `9f34abe`, pushed `codex/issue-723` to `origin/codex/issue-723`, opened draft PR `#748`, reran the issue's focused test/build verification, and kept the only remaining local dirt to the pre-existing untracked `.codex-supervisor/replay/decision-cycle-snapshot.json` artifact.
- Current blocker: none
- Next exact step: decide whether to merge or close draft PR `#748` given that PR `#747` already shipped the product behavior and this branch now only carries the journal handoff.
- Verification gap: none in the requested scope; `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts` and `npm run build` pass locally this turn.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this journal update would only lose the refreshed branch/PR handoff for this turn; product behavior would stay unchanged because it is already on `origin/main`.
- Last focused command: `date -u +"%Y-%m-%dT%H:%M:%SZ"`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-723/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-723/context-index.md
sed -n '1,360p' .codex-supervisor/issue-journal.md
git status --short --branch
git diff --stat
git diff -- .codex-supervisor/issue-journal.md
git log --oneline --decorate -5
git show --stat --summary --format=fuller 9f34abe
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git branch -vv
git branch -r | rg 'origin/codex/issue-723|origin/main'
gh pr status
gh pr list --head codex/issue-723 --state all
git push -u origin codex/issue-723
gh pr create --draft --base main --head codex/issue-723 --title "docs: refresh issue 723 journal handoff" --body ...
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts
npm run build
gh pr view 748 --json number,url,state,isDraft,baseRefName,headRefName,title
date -u +"%Y-%m-%dT%H:%M:%SZ"
git status --short --branch
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
