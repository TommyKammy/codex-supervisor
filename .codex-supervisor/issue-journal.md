# Issue #1305: [codex] Reject missing or untracked repo-relative workspacePreparationCommand targets at config write time

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1305
- Branch: codex/issue-1305
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a5af941fbfad550b9b0d07550b62700e9ef214ac
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-05T23:35:04.603Z

## Latest Codex Summary
- Reproduced that `updateSetupConfig` persisted invalid repo-relative `workspacePreparationCommand` values instead of rejecting them at write time.
- Added focused config-write coverage for missing, untracked, tracked, and non-file command cases.
- Fixed the write path to validate the prospective config document before backup rotation or disk writes.
- Pushed `codex/issue-1305` and opened draft PR #1309.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The existing worktree validator only surfaced through diagnostics/readiness and was not enforced during setup config writes, so invalid helper paths were written and only warned about later.
- What changed: `updateSetupConfig` now validates the prospective config document before creating backups or writing JSON; added focused tests covering missing/untracked rejection plus tracked/non-file acceptance.
- Current blocker: none
- Next exact step: Monitor draft PR #1309 for CI and review feedback, then address any follow-up failures or comments.
- Verification gap: The issue body mentions `src/setup-config-write.test.ts`, but that file does not exist in this branch; verified with `src/config.test.ts` plus `npm run build` instead.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/setup-config-write.ts`, `src/config.test.ts`
- Rollback concern: Low; the change only tightens config-write validation for repo-relative helper commands and preserves prior behavior for tracked helpers and non-file commands.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1305 --title "[codex] Reject missing or untracked repo-relative workspacePreparationCommand targets at config write time" ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
