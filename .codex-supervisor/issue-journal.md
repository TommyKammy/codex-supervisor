# Issue #999: Workspace restore robustness: replace brittle remote-branch stderr matching with machine-checkable existence checks

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/999
- Branch: codex/issue-999
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4d1f012e8bd49961bf60f369aabbbbc444fc0bc9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T14:35:57Z

## Latest Codex Summary
- Replaced workspace restore's brittle `git fetch` stderr matching with an explicit `git ls-remote --exit-code --heads origin <branch>` existence check, added a focused regression test that proves missing remote branches stay non-fatal even when fetch stderr wording changes, and reran the requested focused tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `ensureWorkspace` treated a missing remote issue branch as a special case only when `git fetch` stderr matched one exact English substring, so alternate Git error wording turned an expected bootstrap path into a hard failure.
- What changed: added `originBranchExists()` in `src/core/workspace.ts` to check `git ls-remote --exit-code --heads origin <branch>` before fetching the remote tracking ref; if the branch is absent, restore now deletes any stale `refs/remotes/origin/<branch>` ref and falls back to `origin/<defaultBranch>` without parsing stderr text. Added a focused regression test in `src/core/workspace.test.ts` that intercepts only the issue-branch fetch and returns alternate missing-branch stderr to prove the bootstrap path remains non-fatal.
- Current blocker: none.
- Next exact step: commit the workspace restore fix on `codex/issue-999` and, if required by supervisor flow, open or update the draft PR for this branch.
- Verification gap: none locally after `npm ci`; `npx tsx --test src/core/workspace.test.ts src/doctor.test.ts` and `npm run build` both passed.
- Files touched: `src/core/workspace.ts`; `src/core/workspace.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; changes are limited to workspace restore branch detection and one focused regression test.
- Last focused command: `npm run build`
- Exact failure reproduced: before the fix, the new regression test failed with `Error: fatal: remote branch codex/issue-724 not found` because `fetchIssueRemoteTrackingRef()` only recognized `couldn't find remote ref refs/heads/<branch>` as the non-fatal missing-branch case.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-999/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-999/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "stderr|fetch|ls-remote|remote branch|missing remote|restore" src`; `rg --files src | rg "workspace|restore|doctor"`; `git log --oneline --decorate -n 12 -- src/core/workspace.ts src/core/workspace.test.ts src/doctor.test.ts`; `sed -n '1,260p' src/core/workspace.ts`; `sed -n '1,260p' src/core/workspace.test.ts`; `sed -n '260,520p' src/core/workspace.test.ts`; `rg -n "mock\\.module|mock\\.method|runCommand" src/core src | head -n 200`; `sed -n '1,240p' src/core/command.ts`; `cat package.json`; `rg -n '"type"\\s*:\\s*"module"|tsx --test|node --test' package.json tsconfig*.json`; `npx tsx --test src/core/workspace.test.ts`; `npx tsx --test src/core/workspace.test.ts src/doctor.test.ts`; `npm ci`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git diff -- src/core/workspace.ts src/core/workspace.test.ts .codex-supervisor/issue-journal.md`.
- PR status: none for this issue yet.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
