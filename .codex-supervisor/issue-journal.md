# Issue #1014: Orphan grace runtime guard: add regression coverage for programmatically invalid cleanupOrphanedWorkspacesAfterHours

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1014
- Branch: codex/issue-1014
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 7cc4101d26a4b1b74c05ee8d752dad77abacff91
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T18:36:50Z

## Latest Codex Summary
Added a focused regression test in [src/recovery-reconciliation.test.ts](src/recovery-reconciliation.test.ts) that loads a valid config from disk, mutates `cleanupOrphanedWorkspacesAfterHours` to `-1`, and asserts the runtime orphan-prune entry point still throws `Invalid config field: cleanupOrphanedWorkspacesAfterHours`. That keeps the existing load-time validation in [src/config.test.ts](src/config.test.ts) and adds the missing post-load mutation coverage.

I reran the requested focused verification on commit `7cc4101` (`Add orphan grace runtime guard regression test`), pushed `codex/issue-1014`, and opened draft PR `#1030` (`Issue #1014: add orphan grace runtime guard regression coverage`).

Summary: Added a narrow regression test for post-load invalid orphan grace values, reran focused verification, pushed the branch, and opened draft PR #1030.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/config.test.ts src/recovery-reconciliation.test.ts`; `npm run build`
Next action: monitor PR #1030 checks and promote from draft when review-ready
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the runtime guard in `orphanedWorkspaceGracePeriodHours` already handles programmatically invalid orphan-grace values; the missing coverage was the specific path where config loads validly and is mutated afterward.
- What changed: added a narrow regression test in `src/recovery-reconciliation.test.ts` that loads a valid config from disk, mutates `cleanupOrphanedWorkspacesAfterHours` to `-1`, and asserts `pruneOrphanedWorkspacesForOperator` throws `Invalid config field: cleanupOrphanedWorkspacesAfterHours`.
- Current blocker: none locally.
- Next exact step: monitor draft PR `#1030` and move it forward once checks settle.
- Verification gap: none for the requested local checks after installing workspace dependencies with `npm ci`.
- Files touched: `src/recovery-reconciliation.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the code change is test-only and does not alter production behavior.
- Last focused command: `gh api repos/TommyKammy/codex-supervisor/pulls/1030 -X PATCH --raw-field body=...`
- Exact failure reproduced: before the new test, the suite covered load-time validation and direct invalid runtime config objects, but not the post-load mutation path where a previously valid `cleanupOrphanedWorkspacesAfterHours` becomes invalid before orphan reconciliation runs.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -5`; `git diff -- .codex-supervisor/issue-journal.md`; `gh pr status`; `git diff --stat origin/main...HEAD`; `npx tsx --test src/config.test.ts src/recovery-reconciliation.test.ts`; `npm run build`; `git diff HEAD -- .codex-supervisor/issue-journal.md`; `git diff -- src/recovery-reconciliation.test.ts`; `git diff --stat`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `sed -n '1,180p' .codex-supervisor/issue-journal.md`; `git push -u origin codex/issue-1014`; `gh pr create --draft --base main --head codex/issue-1014 --title "Issue #1014: add orphan grace runtime guard regression coverage" --body ...`; `gh pr view 1030 --json number,title,state,isDraft,url,body`; `gh pr edit 1030 --body-file -`; `gh api repos/TommyKammy/codex-supervisor/pulls/1030 -X PATCH --raw-field body=...`.
- PR status: draft PR `#1030` open at https://github.com/TommyKammy/codex-supervisor/pull/1030.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
