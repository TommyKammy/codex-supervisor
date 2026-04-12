# Issue #1467: Document tmux as the supported macOS loop host and fail closed on direct launchd loop install

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1467
- Branch: codex/issue-1467
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 96fcafd4268ff0fafc4c1eef7d0d8bf5c415b5eb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-12T22:50:15.098Z

## Latest Codex Summary
- Reproduced the unsupported macOS direct launchd loop path with a focused launcher-assets regression, then changed `scripts/install-launchd.sh` to fail closed with explicit tmux/WebUI guidance instead of installing a loop LaunchAgent.
- Updated `README.md`, `docs/getting-started.md`, and `docs/getting-started.ja.md` so macOS loop hosting points to the supported tmux start/stop scripts, while Linux systemd and WebUI launchd guidance remain distinct. Added focused docs assertions and refreshed matching configuration wording required by the existing getting-started doc suite.
- Verified with `npx tsx --test src/getting-started-docs.test.ts`, `npx tsx --test src/managed-restart-launcher-assets.test.ts`, and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The macOS loop host should be tmux only; the old direct launchd installer was the unsupported contract that needed to fail closed, while docs needed to state the supported tmux start/stop path explicitly.
- What changed: Replaced the direct launchd loop installer body with a fail-closed message that points operators to `./scripts/start-loop-tmux.sh`, `./scripts/stop-loop-tmux.sh`, and `./scripts/install-launchd-web.sh`. Updated English and Japanese getting-started docs plus README macOS loop guidance. Added focused regression coverage for the installer behavior and the macOS tmux wording. Added minimal matching phrasing in `docs/configuration.md` so the existing getting-started docs suite remains green.
- Current blocker: none
- Next exact step: Commit the checkpoint and leave the branch ready for PR creation or the next supervisor pass.
- Verification gap: No live manual tmux session launch on macOS host; verification is focused on script behavior, docs wording, and build integrity.
- Files touched: .codex-supervisor/issue-journal.md; README.md; docs/configuration.md; docs/getting-started.md; docs/getting-started.ja.md; scripts/install-launchd.sh; src/getting-started-docs.test.ts; src/managed-restart-launcher-assets.test.ts; src/readme-docs.test.ts
- Rollback concern: Low; the change narrows macOS loop installation behavior by failing closed and only adjusts operator docs/tests around the supported tmux path.
- Last focused command: npm run build
### Scratchpad
- Focused reproducer that failed before the fix: `npx tsx --test src/managed-restart-launcher-assets.test.ts`
- Focused verification after the fix: `npx tsx --test src/getting-started-docs.test.ts src/managed-restart-launcher-assets.test.ts src/readme-docs.test.ts`
