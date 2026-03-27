# Issue #1113: Update shipped supervisor configs to use issue-scoped journal paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1113
- Branch: codex/issue-1113
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T11:48:15+00:00

## Latest Codex Summary
- Added a focused shipped-config regression test for `issueJournalRelativePath`, updated all repo-owned preset/example configs to the issue-scoped template, and reran `src/config.test.ts`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: repo-owned preset and example configs are still pinning the legacy shared journal path, so they bypass the intended issue-scoped path until those tracked files are updated.
- What changed: added a focused regression test in `src/config.test.ts` that asserts all shipped preset/example configs use `.codex-supervisor/issues/{issueNumber}/issue-journal.md` and that an explicit custom `issueJournalRelativePath` still survives `loadConfig()`. Updated `supervisor.config.example.json`, `supervisor.config.copilot.json`, `supervisor.config.codex.json`, `supervisor.config.coderabbit.json`, `docs/examples/atlaspm.supervisor.config.example.json`, and `docs/examples/atlaspm.md` to the issue-scoped template.
- Current blocker: none locally.
- Next exact step: commit this shipped-config checkpoint on `codex/issue-1113`; if another pass is needed afterward, decide whether the code default in `src/core/config.ts` should be aligned in a separate change because this checkout still defaults to the legacy shared path.
- Verification gap: I have not run the full repo suite or an end-to-end supervisor loop; verification so far is focused on `src/config.test.ts`.
- Files touched: `src/config.test.ts`; `supervisor.config.example.json`; `supervisor.config.copilot.json`; `supervisor.config.codex.json`; `supervisor.config.coderabbit.json`; `docs/examples/atlaspm.supervisor.config.example.json`; `docs/examples/atlaspm.md`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change is limited to repo-owned starter configs/examples plus a focused config regression test, and it leaves explicit custom journal paths unchanged.
- Last focused command: `npx tsx --test src/config.test.ts`
- What changed this turn: reread the required memory files and journal, found every shipped preset/example still pinned to `.codex-supervisor/issue-journal.md`, added the narrow failing assertion in `src/config.test.ts`, updated the repo-owned config/example files to the issue-scoped template, and reran the focused config suite to green.
- Exact failure reproduced this turn: `src/config.test.ts` failed because `supervisor.config.example.json` and the other shipped presets/examples still set `issueJournalRelativePath` to `.codex-supervisor/issue-journal.md` instead of `.codex-supervisor/issues/{issueNumber}/issue-journal.md`.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1113/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1113/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `rg -n "issueJournalRelativePath|issue-journal\\.md" -S .`; `rg -n "loadConfig|issueJournalRelativePath|supervisor.config" src test docs -g'*.ts' -g'*.json' -g'*.md'`; `sed -n '680,790p' src/config.test.ts`; `sed -n '1,120p' src/supervisor/replay-corpus-config.test.ts`; `sed -n '450,500p' src/core/config.ts`; `sed -n '1,120p' supervisor.config.example.json`; `sed -n '1,120p' supervisor.config.copilot.json`; `sed -n '1,120p' supervisor.config.codex.json`; `sed -n '1,120p' supervisor.config.coderabbit.json`; `sed -n '1,120p' docs/examples/atlaspm.supervisor.config.example.json`; `sed -n '35,70p' docs/examples/atlaspm.md`; `rg -n "issueJournalRelativePath.*default|defaults? to .*issue-journal|falls back.*issueJournalRelativePath|issue-scoped" src/config.test.ts src/core/config*.test.ts src -g'*.test.ts'`; `sed -n '1,140p' src/config.test.ts`; `sed -n '140,360p' src/config.test.ts`; `npx tsx --test src/config.test.ts`; `git diff --stat`; `git diff -- src/config.test.ts supervisor.config.example.json supervisor.config.copilot.json supervisor.config.codex.json supervisor.config.coderabbit.json docs/examples/atlaspm.supervisor.config.example.json docs/examples/atlaspm.md`; `date -Iseconds -u`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
