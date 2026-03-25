# Issue #1015: Orphan grace fail-fast: validate cleanupOrphanedWorkspacesAfterHours before orphan iteration begins

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1015
- Branch: codex/issue-1015
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6ab566263e58e95fa25b22f0e53f508dc15d60d5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T18:49:21Z

## Latest Codex Summary
- Confirmed `origin/main` already validates `cleanupOrphanedWorkspacesAfterHours` at the top of `inspectOrphanedWorkspacePruneCandidates`, before workspace enumeration or candidate iteration begin. Added focused regression coverage in `src/recovery-reconciliation.test.ts` for the post-load mutation case on the inspection path itself, proving the fail-fast error still throws with zero orphan candidates. Installed workspace dependencies with `npm ci`, reran the focused recovery test file and `npm run build`, committed the test/journal update as `6ab5662`, pushed `codex/issue-1015`, and opened draft PR `#1031`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue `#1015` is already functionally fixed on `main`; the remaining gap was proving the candidate-inspection entry point fails fast before orphan listing/iteration when a once-valid config is mutated at runtime.
- What changed: added a narrow regression test in `src/recovery-reconciliation.test.ts` that loads a valid config from disk, mutates `cleanupOrphanedWorkspacesAfterHours` to `-1`, and asserts `inspectOrphanedWorkspacePruneCandidates` throws `Invalid config field: cleanupOrphanedWorkspacesAfterHours` with an empty workspace root.
- Current blocker: none locally.
- Next exact step: monitor draft PR `#1031` and address CI or review feedback if anything regresses.
- Verification gap: none for the requested local checks after installing workspace dependencies with `npm ci`.
- Files touched: `src/recovery-reconciliation.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the code change is test-only and does not alter production behavior.
- Last focused command: `gh api repos/TommyKammy/codex-supervisor/pulls/1031 -X PATCH --raw-field body=...`
- Exact failure reproduced: before this turn’s new test, the suite proved fail-fast behavior for invalid config objects and for the prune entry point after post-load mutation, but not for the inspection/listing entry point itself when zero orphan candidates exist.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1015/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1015/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -5`; `git diff --stat origin/main...HEAD`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `sed -n '1,320p' src/recovery-reconciliation.test.ts`; `rg -n "inspectOrphanedWorkspacePruneCandidates|pruneOrphanedWorkspacesForOperator|orphanedWorkspaceGracePeriodHours" src/recovery-reconciliation.ts`; `sed -n '260,520p' src/recovery-reconciliation.ts`; `npx tsx --test src/recovery-reconciliation.test.ts`; `npm ci`; `npm run build`; `git status --short`; `git diff -- src/recovery-reconciliation.test.ts .codex-supervisor/issue-journal.md`; `gh pr status`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git add src/recovery-reconciliation.test.ts .codex-supervisor/issue-journal.md`; `git commit -m "Issue #1015: tighten orphan grace fail-fast coverage"`; `git rev-parse HEAD`; `git push -u origin codex/issue-1015`; `gh pr create --draft --base main --head codex/issue-1015 --title "Issue #1015: tighten orphan grace fail-fast coverage" --body ...`; `gh pr view 1031 --json number,title,isDraft,url,body`; `gh api repos/TommyKammy/codex-supervisor/pulls/1031 -X PATCH --raw-field body=...`.
- PR status: draft PR `#1031` open at https://github.com/TommyKammy/codex-supervisor/pull/1031.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
