# Issue #1007: Journal durability: write issue journals atomically to avoid handoff corruption on interruption

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1007
- Branch: codex/issue-1007
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2bf4803c0e3c41b562f65b97583ca65a322586fd
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T16:20:21Z

## Latest Codex Summary
- Reproduced that `syncIssueJournal` wrote directly to `.codex-supervisor/issue-journal.md`, added a focused regression that asserts the journal is staged through a temp file and renamed into place, and switched journal persistence to the shared atomic write helper. Focused tests and `npm run build` now pass.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `src/core/journal.ts` is the only journal writer and its direct `fs.writeFile(journalPath, nextContent, "utf8")` call is what can leave a truncated handoff behind if the process is interrupted mid-write.
- What changed: added a focused regression in `src/journal.test.ts` that mocks `fs.writeFile` and `fs.rename` to prove `syncIssueJournal` stages through a temp file before replacing the live journal. Added `writeFileAtomic` in `src/core/utils.ts`, kept `writeJsonAtomic` on the same helper, and switched `syncIssueJournal` to that atomic path without changing journal content or interfaces.
- Current blocker: none.
- Next exact step: commit the journal atomic-write change on `codex/issue-1007`, then open or update a draft PR if one does not already exist for this branch.
- Verification gap: none after `npx tsx --test src/journal.test.ts src/core/utils.test.ts` and `npm run build`.
- Files touched: `src/core/journal.ts`; `src/core/utils.ts`; `src/journal.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; journal output bytes are unchanged, and the runtime change is limited to writing the file through a temp path and atomic rename.
- Last focused command: `npm run build`
- Exact failure reproduced: `npx tsx --test src/journal.test.ts` failed with `AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to: '<redacted-local-path>'`, confirming that `syncIssueJournal` wrote directly to the live journal path instead of staging through a temp file.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "issue-journal|journal|writeFile|rename|writeJsonAtomic|atomic" src test -g'*.ts'`; `sed -n '1,260p' src/core/utils.ts`; `rg --files src | rg 'journal|utils|state-store'`; `git diff -- src/core/utils.ts src/core/utils.test.ts .codex-supervisor/issue-journal.md`; `sed -n '1,280p' src/core/journal.ts`; `sed -n '1,320p' src/journal.test.ts`; `rg -n "syncIssueJournal|readIssueJournal|issueJournalPath|writeFile\\(|appendFile\\(|rename\\(" src/core src -g'*.ts'`; `sed -n '480,540p' src/core/journal.ts`; `sed -n '320,520p' src/journal.test.ts`; `npx tsx --test src/journal.test.ts`; `rg -n "mock\\.method|t\\.mock|import .*mock.*node:test|spyOn" src -g'*.test.ts'`; `sed -n '1,220p' src/core/utils.test.ts`; `npx tsx --test src/journal.test.ts`; `git diff --check -- src/core/journal.ts src/core/utils.ts src/journal.test.ts`; `test -d node_modules && echo node_modules-present || echo node_modules-missing`; `test -f package-lock.json && echo lock-present || echo lock-missing`; `sed -n '1,220p' package.json`; `npm ci`; `npx tsx --test src/journal.test.ts src/core/utils.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git status --short`.
- PR status: none yet on this branch.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
