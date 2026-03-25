# Issue #999: Workspace restore robustness: replace brittle remote-branch stderr matching with machine-checkable existence checks

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/999
- Branch: codex/issue-999
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: e7ccdfb890c75d10964c73d6e844c1b1b601ec1b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T14:45:41Z

## Latest Codex Summary
Replaced the brittle missing-remote-branch handling in [workspace.ts](src/core/workspace.ts) with a machine-checkable `git ls-remote --exit-code --heads origin <branch>` check before fetch. If the branch is absent, restore now deletes any stale `refs/remotes/origin/<branch>` ref and cleanly bootstraps from `origin/main` instead of depending on one exact `git fetch` stderr string.

Added a focused regression in [workspace.test.ts](src/core/workspace.test.ts) that simulates alternate missing-branch stderr wording and proves `ensureWorkspace` still takes the non-fatal bootstrap path. I also updated [issue-journal.md](.codex-supervisor/issue-journal.md) with the reproduced failure, commands run, and next action. Commit: `e146e9e`.

Summary: Replaced stderr-based remote branch detection in workspace restore with `ls-remote` existence checks, added a focused regression test, updated the issue journal, and committed the fix as `e146e9e`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/core/workspace.test.ts src/doctor.test.ts`; `npm ci`; `npm run build`
Next action: Open or update the draft PR for `codex/issue-999` and push commit `e146e9e` for CI
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `ensureWorkspace` treated a missing remote issue branch as a special case only when `git fetch` stderr matched one exact English substring, so alternate Git error wording turned an expected bootstrap path into a hard failure.
- What changed: added `originBranchExists()` in `src/core/workspace.ts` to check `git ls-remote --exit-code --heads origin <branch>` before fetching the remote tracking ref; if the branch is absent, restore now deletes any stale `refs/remotes/origin/<branch>` ref and falls back to `origin/<defaultBranch>` without parsing stderr text. Added a focused regression test in `src/core/workspace.test.ts` that intercepts only the issue-branch fetch and returns alternate missing-branch stderr to prove the bootstrap path remains non-fatal.
- Current blocker: none.
- Next exact step: monitor draft PR `#1019` for CI and review feedback, then address any failures or review comments that come back.
- Verification gap: none locally after `npm ci`; `npx tsx --test src/core/workspace.test.ts src/doctor.test.ts` and `npm run build` both passed.
- Files touched: `src/core/workspace.ts`; `src/core/workspace.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; changes are limited to workspace restore branch detection and one focused regression test.
- Last focused command: `npx tsx --test src/core/workspace.test.ts src/doctor.test.ts`
- Exact failure reproduced: before the fix, the new regression test failed with `Error: fatal: remote branch codex/issue-724 not found` because `fetchIssueRemoteTrackingRef()` only recognized `couldn't find remote ref refs/heads/<branch>` as the non-fatal missing-branch case.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 5`; `gh pr status`; `git branch -vv`; `git remote -v`; `git push -u origin codex/issue-999`; `gh pr create --draft --base main --head codex/issue-999 --title "Issue #999: Fix workspace restore remote branch detection" --body ...`; `gh pr view 1019 --json url,isDraft,headRefName,baseRefName,mergeStateStatus`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "Update issue 999 journal after draft PR"`; `git push`; `gh pr view 1019 --json url,isDraft,mergeStateStatus,headRefOid`; `npx tsx --test src/core/workspace.test.ts src/doctor.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1019` on head `e7ccdfb890c75d10964c73d6e844c1b1b601ec1b`; current merge state status `UNSTABLE` pending CI.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
