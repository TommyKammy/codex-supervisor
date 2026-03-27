# Issue #1115: Fail fast when issue journal path templates leave {issueNumber} unresolved

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1115
- Branch: codex/issue-1115
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 9b5e4f0c349c6af0b95434e0ccc00c1d476eb454
- Blocked reason: none
- Last failure signature: dirty:9b5e4f0c349c6af0b95434e0ccc00c1d476eb454
- Repeated failure signature count: 1
- Updated at: 2026-03-27T12:37:25.971Z

## Latest Codex Summary
Draft PR is open at https://github.com/TommyKammy/codex-supervisor/pull/1117 from `codex/issue-1115`. I reran the focused regression set against the committed checkpoint `9b5e4f0`, and it passed cleanly.

No implementation changes were needed this turn. I updated [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) with the PR state, verification rerun, commands run, and next handoff. The only local dirt now is that journal edit plus the existing supervisor runtime artifacts.

Summary: Pushed `codex/issue-1115` to GitHub, opened draft PR #1117 for commit `9b5e4f0`, reran the focused tests, and updated the issue journal handoff.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-cycle-replay.test.ts`
Next action: watch PR #1117 CI and address any failures or review feedback if they appear
Failure signature: dirty:9b5e4f0c349c6af0b95434e0ccc00c1d476eb454

## Active Failure Context
- Category: conflict
- Summary: PR #1117 has merge conflicts and needs a base-branch integration pass.
- Command or source: git fetch origin && git merge origin/<default-branch>
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1117
- Details:
  - mergeStateStatus=DIRTY

## Codex Working Notes
### Current Handoff
- Hypothesis: `issueJournalPath(...)` should be the fail-fast boundary for tokenized issue journal templates, rejecting unresolved `{issueNumber}` placeholders while leaving plain custom paths untouched.
- What changed: added focused `src/journal.test.ts` coverage for unresolved-token failure, valid token substitution, and non-tokenized custom paths; updated `issueJournalPath(...)` to replace `{issueNumber}` only when an `issueNumber` is supplied and otherwise throw a clear error; threaded `issueNumber` through the selection, preparation, and supervisor call sites that derive `journal_path` from config.
- Current blocker: none locally.
- Next exact step: monitor draft PR #1117 and fix CI or review feedback if any integration path exposes a missed caller.
- Verification gap: I have not run the full repo suite or an end-to-end supervisor loop; verification so far is limited to the journal helper and the narrow selection/preparation/replay tests that exercise journal-path persistence.
- Files touched: `src/core/journal.ts`; `src/journal.test.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-issue-selection.ts`; `src/supervisor/supervisor.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The behavioral change is narrowly scoped to templates containing `{issueNumber}`; non-tokenized paths still resolve exactly as before.
- Last focused command: `gh pr view 1117 --json number,state,isDraft,url,title`
- What changed this turn: reread the required memory and journal files, confirmed the committed checkpoint at `9b5e4f0`, reran the focused journal-path-related tests as a combined command, pushed `codex/issue-1115` to the GitHub remote, and opened draft PR #1117 for review.
- Exact failure reproduced this turn: `issueJournalPath("<redacted-local-path>", ".codex-supervisor/issues/{issueNumber}/issue-journal.md")` returned a resolved path that still contained the literal `{issueNumber}` token instead of rejecting the invalid durable path state.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `git log --oneline --decorate -5`; `gh pr view --json number,state,isDraft,title,headRefName,baseRefName,url`; `git show --stat --oneline --decorate HEAD`; `git ls-remote --heads origin codex/issue-1115`; `npx tsx --test src/journal.test.ts src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-cycle-replay.test.ts`; `git push -u origin codex/issue-1115`; `gh pr create --draft --base main --head codex/issue-1115 --title "Fail fast on unresolved issue journal templates" --body ...`; `git remote -v`; `gh repo view --json nameWithOwner,defaultBranchRef,url`; `git rev-list --left-right --count origin/main...codex/issue-1115`; `git push -u github codex/issue-1115`; `git rev-list --left-right --count github/main...codex/issue-1115`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `gh pr view 1117 --json number,state,isDraft,url,title`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
