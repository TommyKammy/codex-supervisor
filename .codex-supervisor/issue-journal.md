# Issue #723: Remote branch restore: recover missing local issue branches from origin before bootstrapping from default

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/723
- Branch: codex/issue-723
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 4 (implementation=4, repair=0)
- Last head SHA: 33b904323fbf9baf8e365b13b8160f3c25b05ae0
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 1
- Updated at: 2026-03-20T19:07:52Z

## Latest Codex Summary
No product-code change was needed in this worktree. `ensureWorkspace()` still implements the requested precedence in [src/core/workspace.ts:91](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/src/core/workspace.ts#L91): existing local branch first, remote issue branch second at [src/core/workspace.ts:111](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/src/core/workspace.ts#L111), and default-branch bootstrap last at [src/core/workspace.ts:119](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/src/core/workspace.ts#L119). The focused coverage for both the bootstrap fallback and remote-restore cases is still present in [src/core/workspace.test.ts:95](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/src/core/workspace.test.ts#L95) and [src/core/workspace.test.ts:107](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/src/core/workspace.test.ts#L107), and the issue's requested verification passes on this turn.

I refreshed the handoff in [issue-journal.md:16](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-723/.codex-supervisor/issue-journal.md#L16). The branch still matches `origin/main` at `33b9043` (`Remote branch discovery before bootstrap (#747)`), there is still no `origin/codex/issue-723`, and `gh pr status` still shows no PR for this branch because it tracks `origin/main`, so there is no reviewable product diff to commit or open as a PR from this worktree.

Summary: Re-verified issue #723 as already shipped on `origin/main`; refreshed the journal with current branch state and passing verification.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts`; `npm run build`
Failure signature: none
Next action: Decide whether to close or supersede issue #723 as already satisfied by PR `#747`, since `codex/issue-723` still has no product diff and no issue-specific remote branch or PR.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: No product-code change is required for #723 in this worktree because the requested local -> remote -> bootstrap restore behavior is already implemented on `origin/main`, and this branch still has no remaining commit diff from that shipped commit.
- What changed: re-read the required memory files and journal, rechecked `src/core/workspace.ts` and `src/core/workspace.test.ts`, confirmed `codex/issue-723` still matches `origin/main` at `33b9043`, confirmed there is still no `origin/codex/issue-723` remote branch and no PR for this branch, reran the issue's focused test/build verification, and noted the only local changes remain this journal plus an untracked `.codex-supervisor/replay/decision-cycle-snapshot.json` artifact.
- Current blocker: none
- Next exact step: decide whether to close or supersede issue #723 as already shipped in PR `#747`, because there is no product diff to commit or PR to open from `codex/issue-723`.
- Verification gap: none in the requested scope; `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts` and `npm run build` pass locally this turn.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this journal update would only lose the refreshed verification and branch-state handoff for this turn; product behavior would stay unchanged.
- Last focused command: `git status --short`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-723/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-723/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
git diff --stat origin/main...HEAD
git rev-parse --short HEAD && git rev-parse --short origin/main
git branch -vv
git branch -r | rg 'origin/codex/issue-723|origin/main'
gh pr status
sed -n '1,220p' src/core/workspace.ts
sed -n '1,220p' src/core/workspace.test.ts
git show --stat --oneline --decorate --no-patch 33b9043
find .codex-supervisor/replay -maxdepth 2 -type f | sort
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
git status --short
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
