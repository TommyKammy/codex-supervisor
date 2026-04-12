# Issue #1466: Add tmux-backed macOS loop launcher scripts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1466
- Branch: codex/issue-1466
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 689b916a17df37ff28eca36bde07e90ec390ea32
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-12T22:16:28.237Z

## Latest Codex Summary
- Added macOS `tmux` loop launcher scripts with explicit launcher metadata, idempotent single-session start behavior, matching stop behavior, and focused asset coverage.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The missing macOS loop launcher support can be added safely by following the existing launcher-asset pattern: assert shell-script contracts in `src/managed-restart-launcher-assets.test.ts` and implement a start/stop script pair under `scripts/` without changing Linux/systemd behavior.
- What changed: Added focused asset coverage for `scripts/start-loop-tmux.sh` and `scripts/stop-loop-tmux.sh`, then implemented those scripts with a stable `codex-supervisor-loop` session default, `tmux has-session` idempotence, explicit `CODEX_SUPERVISOR_LAUNCHER=tmux` and `CODEX_SUPERVISOR_TMUX_SESSION` metadata, PATH/NODE/NPM/config propagation into the tmux session, and explicit missing-`tmux` diagnostics.
- Current blocker: none
- Next exact step: Review the diff, commit the launcher/test changes, and open a draft PR if one still does not exist.
- Verification gap: No live tmux integration run yet; local verification is currently asset-focused plus `npm run build`.
- Files touched: .codex-supervisor/issue-journal.md; src/managed-restart-launcher-assets.test.ts; scripts/start-loop-tmux.sh; scripts/stop-loop-tmux.sh
- Rollback concern: Low; the change only adds new macOS helper scripts and test coverage, with no edits to existing Linux/systemd launcher paths.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
