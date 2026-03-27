# Issue #1103: Journal write enforcement: normalize every committed issue-journal write path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1103
- Branch: codex/issue-1103
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T07:34:07.161Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: a direct Codex rewrite of `.codex-supervisor/issue-journal.md` can bypass `syncIssueJournal()` path sanitization until after the run, so the turn flow needs a shared live-journal normalization step before post-run persistence/classification continues.
- What changed: added shared journal-content normalization helpers in `src/core/journal.ts`, reused that normalization in `syncIssueJournal()`, and invoked a direct live-journal normalization pass inside `executeCodexTurnPhase()` immediately after the run. Added a focused regression in `src/run-once-turn-execution.test.ts` that simulates a journal-only `local_review_fix` rewrite containing workspace-local absolute paths and asserts the persisted journal text keeps repo-relative paths while redacting host-only paths.
- Current blocker: none locally.
- Next exact step: review the focused diff, commit the `#1103` checkpoint on `codex/issue-1103`, and then decide whether an additional supervisor-level orchestration test is worth adding around a committed journal-only review-fix flow.
- Verification gap: I have not run the full repo suite or an end-to-end supervisor loop; verification so far is focused on `src/journal.test.ts` and `src/run-once-turn-execution.test.ts`.
- Files touched: `src/core/journal.ts`; `src/run-once-turn-execution.ts`; `src/run-once-turn-execution.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The new helper only rewrites `.codex-supervisor/issue-journal.md` when durable normalization would change the content, and the existing snapshot-sync path still uses the same sanitizer.
- Last focused command: `npx tsx --test src/journal.test.ts src/run-once-turn-execution.test.ts`
- What changed this turn: reread the required memory files, traced the journal sanitizer and post-turn flow, identified that direct journal rewrites could sit outside the shared durable normalization until after the turn finished, added a shared live-journal normalization helper, wired it into `executeCodexTurnPhase()`, added a focused journal-only `local_review_fix` regression, and reran the targeted tests.
- Exact failure reproduced this turn: a successful turn that directly rewrote `.codex-supervisor/issue-journal.md` with `${PWD}`-style workspace paths and `/home/...` host-only paths left those raw absolute paths in the durable journal until a later `syncIssueJournal()` pass, so a journal-only review-fix path could bypass the sanitizer during post-run handling.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,220p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `rg -n "issue-journal|syncIssueJournal|normalize.*path|redacted-local-path|sanitize" src .`; `rg --files src | rg "journal|issue|supervisor|sync|normaliz|sanitize|durable|rewrite"`; `sed -n '1,320p' src/core/journal.ts`; `sed -n '1,320p' src/journal.test.ts`; `rg -n "writeFile\\(|issue-journal\\.md|journalPath|syncIssueJournal\\(|save.*journal|rewrite.*journal|commit.*journal|Working Notes|Codex Working Notes" src`; `rg -n "writeFileAtomic\\(|fs\\.writeFile\\(|journalPath" src/core/journal.ts src/supervisor/supervisor.ts src/run-once-turn-execution.ts src/run-once-issue-selection.ts src/run-once-issue-preparation.ts`; `sed -n '320,620p' src/core/journal.ts`; `sed -n '620,860p' src/supervisor/supervisor.ts`; `sed -n '240,380p' src/run-once-turn-execution.ts`; `sed -n '420,560p' src/run-once-issue-selection.ts`; `sed -n '1,260p' src/turn-execution-failure-helpers.ts`; `sed -n '1,260p' src/interrupted-turn-marker.ts`; `sed -n '180,260p' src/supervisor/supervisor.ts`; `sed -n '480,530p' src/supervisor/supervisor.ts`; `sed -n '1,140p' src/run-once-turn-execution.test.ts`; `sed -n '1,220p' src/turn-execution-test-helpers.ts`; `tail -n 80 src/run-once-turn-execution.test.ts`; `git diff -- src/core/journal.ts src/run-once-turn-execution.ts src/run-once-turn-execution.test.ts`; `npx tsx --test src/journal.test.ts src/run-once-turn-execution.test.ts`; `git diff --stat`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
