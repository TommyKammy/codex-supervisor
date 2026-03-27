# Issue #1115: Fail fast when issue journal path templates leave {issueNumber} unresolved

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1115
- Branch: codex/issue-1115
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T12:25:17.879Z

## Latest Codex Summary
- Reproduced unresolved `{issueNumber}` journal template handling in `issueJournalPath(...)`, added focused regression coverage, and updated journal-path resolution call sites to fail fast unless a concrete issue number is supplied.

## Active Failure Context
- Category: test
- Summary: `issueJournalPath(...)` previously resolved tokenized journal path templates without substituting `{issueNumber}`, allowing unresolved placeholders to become durable `journal_path` state.
- Signature: issue-journal-path-unresolved-issue-number
- Updated at: 2026-03-27T12:25:17.879Z

## Codex Working Notes
### Current Handoff
- Hypothesis: `issueJournalPath(...)` should be the fail-fast boundary for tokenized issue journal templates, rejecting unresolved `{issueNumber}` placeholders while leaving plain custom paths untouched.
- What changed: added focused `src/journal.test.ts` coverage for unresolved-token failure, valid token substitution, and non-tokenized custom paths; updated `issueJournalPath(...)` to replace `{issueNumber}` only when an `issueNumber` is supplied and otherwise throw a clear error; threaded `issueNumber` through the selection, preparation, and supervisor call sites that derive `journal_path` from config.
- Current blocker: none locally.
- Next exact step: review the focused diff, commit the `issueJournalPath` fail-fast fix on `codex/issue-1115`, and only broaden verification if a later integration path shows a missed caller.
- Verification gap: I have not run the full repo suite or an end-to-end supervisor loop; verification so far is limited to the journal helper and the narrow selection/preparation/replay tests that exercise journal-path persistence.
- Files touched: `src/core/journal.ts`; `src/journal.test.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-issue-selection.ts`; `src/supervisor/supervisor.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The behavioral change is narrowly scoped to templates containing `{issueNumber}`; non-tokenized paths still resolve exactly as before.
- Last focused command: `npx tsx --test src/journal.test.ts`
- What changed this turn: reread the required memory and journal files, confirmed the branch head was still an unrelated prior checkpoint, traced `issueJournalPath(...)` and its callers, added a focused reproducing test for unresolved `{issueNumber}`, implemented fail-fast substitution logic, threaded `issueNumber` through the config-backed callers, and reran the narrow journal-path-related tests.
- Exact failure reproduced this turn: `issueJournalPath("/tmp/workspaces/issue-177", ".codex-supervisor/issues/{issueNumber}/issue-journal.md")` returned a resolved path that still contained the literal `{issueNumber}` token instead of rejecting the invalid durable path state.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `git log --oneline --decorate -5`; `rg -n "issueJournalPath|issueJournalRelativePath|\\{issueNumber\\}" src test -g'*.ts'`; `rg --files src test | rg "journal|issue|config|path"`; `sed -n '460,560p' src/core/journal.ts`; `sed -n '1,260p' src/journal.test.ts`; `sed -n '180,240p' src/run-once-issue-preparation.ts`; `sed -n '250,320p' src/run-once-issue-selection.ts`; `sed -n '280,320p' src/supervisor/supervisor.ts`; `sed -n '450,510p' src/core/config.ts`; `rg -n "issueJournalRelativePath|issue-journal" README.md docs/getting-started.md src -g'*.md' -g'*.ts'`; `rg -n "issueJournalPath\\(" src -g'*.ts'`; `sed -n '470,510p' src/supervisor/supervisor.ts`; `sed -n '220,320p' src/run-once-issue-preparation.test.ts`; `git diff -- src/core/journal.ts src/journal.test.ts src/run-once-issue-preparation.ts src/run-once-issue-selection.ts src/supervisor/supervisor.ts`; `npx tsx --test src/journal.test.ts`; `npx tsx --test src/run-once-issue-preparation.test.ts`; `npx tsx --test src/run-once-issue-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-cycle-replay.test.ts`; `git status --short`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
