# Issue #1111: Prevent artificial PR merge conflicts from the shared committed issue journal path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1111
- Branch: codex/issue-1111
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T10:19:37.307Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the durable handoff can stay committed, but the default journal path must be issue-scoped so unrelated branches stop competing on one tracked `.codex-supervisor/issue-journal.md` file.
- What changed: switched the default journal template to `.codex-supervisor/issues/{issueNumber}/issue-journal.md`, resolved the template wherever a journal path is synthesized, updated replay-corpus normalization to keep the issue-scoped path, and added a focused git-based regression that merges one unrelated issue branch into `main` before merging `main` into another issue branch.
- Current blocker: none locally.
- Next exact step: review the final diff, stage only the intended source/test/journal files, commit the checkpoint for `#1111`, and then decide whether to widen verification beyond the focused journal-path ring.
- Verification gap: I have not run the full repository suite or an end-to-end supervisor publication flow; verification so far covers focused journal, preparation, selection, replay, supervisor stale-state, and the new merge-conflict reproduction path.
- Files touched: `src/core/journal.ts`; `src/core/config.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-issue-selection.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/replay-corpus-config.ts`; `src/supervisor/replay-corpus-promotion.ts`; `src/core/workspace.test.ts`; `src/journal.test.ts`; `src/run-once-issue-preparation.test.ts`; `src/supervisor/replay-corpus-config.test.ts`; `src/supervisor/replay-corpus-promotion.test.ts`; `src/index.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The behavioral change is confined to default journal-path synthesis; explicit custom `issueJournalRelativePath` values still work, and the new regression proves unrelated issue branches no longer conflict only because of journal persistence.
- Last focused command: `npx tsx --test src/run-once-issue-selection.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/replay-corpus-runner.test.ts src/supervisor/supervisor-cycle-replay.test.ts`
- What changed this turn: reread the required memory files and journal, traced the default journal-path synthesis through preparation/selection/supervisor flows, added issue-number template resolution, updated the default config and replay-corpus normalization, added a real git merge regression for unrelated branches, and ran focused verification rings around the changed paths.
- Exact failure reproduced this turn: with the old shared committed path, unrelated issue branches would both commit `.codex-supervisor/issue-journal.md`; after one branch merged, merging `main` into the other branch created an avoidable conflict even though the implementation files did not overlap.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `git log --oneline --decorate -5`; `git diff --stat`; `rg -n "issue-journal\\.md|prepareWorkspaceContext|journal" src test`; `rg --files src test | rg "journal|workspace|preparation|resume|handoff|supervisor|persistence|issue"`; `sed -n '1,260p' src/core/journal.ts`; `sed -n '1,320p' src/run-once-issue-preparation.ts`; `sed -n '1,260p' src/journal.test.ts`; `sed -n '1,360p' src/run-once-issue-preparation.test.ts`; `rg -n "issueJournalRelativePath" src`; `sed -n '1,260p' src/core/types.ts`; `sed -n '260,520p' src/core/journal.ts`; `sed -n '440,540p' src/core/config.ts`; `sed -n '1,220p' src/core/memory.ts`; `sed -n '1,220p' src/supervisor/replay-corpus-promotion.ts`; `sed -n '1,220p' src/supervisor/replay-corpus-promotion.test.ts`; `sed -n '1,420p' src/index.test.ts`; `sed -n '1,260p' src/core/workspace.test.ts`; `sed -n '1,260p' src/core/workspace.ts`; `rg -n "issueJournalPath\\(" src`; `sed -n '240,340p' src/run-once-issue-selection.ts`; `sed -n '260,340p' src/supervisor/supervisor.ts`; `sed -n '460,520p' src/supervisor/supervisor.ts`; `npx tsx --test src/journal.test.ts src/run-once-issue-preparation.test.ts src/core/workspace.test.ts src/supervisor/replay-corpus-config.test.ts src/supervisor/replay-corpus-promotion.test.ts src/index.test.ts`; `npx tsx --test src/run-once-issue-selection.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/replay-corpus-runner.test.ts src/supervisor/supervisor-cycle-replay.test.ts`; `git diff --stat`; `git diff -- src/core/journal.ts src/core/config.ts src/core/workspace.test.ts src/run-once-issue-preparation.ts src/run-once-issue-preparation.test.ts src/run-once-issue-selection.ts src/supervisor/supervisor.ts src/supervisor/replay-corpus-config.ts src/supervisor/replay-corpus-promotion.ts src/journal.test.ts src/index.test.ts src/supervisor/replay-corpus-config.test.ts src/supervisor/replay-corpus-promotion.test.ts`; `git status --short`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
