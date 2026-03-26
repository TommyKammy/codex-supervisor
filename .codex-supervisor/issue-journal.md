# Issue #1055: Allow managed automatic restart only when launcher support is available

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1055
- Branch: codex/issue-1055
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c9514cb6d97afb5668c57863e4bf8642a76a4248
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T07:51:02.779Z

## Latest Codex Summary
- Added an explicit managed-restart capability at the WebUI/runtime boundary, exposed it through setup responses, added a guarded `/api/commands/managed-restart` path, and updated the setup shell to enable `Restart now` only when launcher-backed restart support is present.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: managed restart belongs at the WebUI runtime boundary, not in the core supervisor service, so the safe fix is to advertise an explicit launcher-backed capability and only expose a restart command when that capability exists.
- What changed: added `src/managed-restart.ts` with an explicit `ManagedRestartCapability`/controller contract and env-based runtime detection; taught `src/backend/supervisor-http-server.ts` to attach that capability to setup responses and to accept `/api/commands/managed-restart` only when support is present; updated `src/cli/supervisor-runtime.ts` so `web` can advertise managed restart when `CODEX_SUPERVISOR_MANAGED_RESTART=1` and `CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER` are set; taught `src/backend/webui-setup-browser-script.ts` and `src/backend/webui-setup-page.ts` to keep unmanaged sessions manual while enabling a real `Restart now` button for managed sessions; and added focused HTTP, setup-shell, and browser-smoke coverage for both managed and unmanaged paths.
- Current blocker: none locally.
- Next exact step: stage the managed-restart capability changes on `codex/issue-1055`, commit the checkpoint, and open or update the draft PR if requested.
- Verification gap: none in the local scope. The targeted setup browser-smoke cases passed, but `tsx --test --test-name-pattern ...` still executed two unrelated dashboard smoke cases in this environment, so that command exited non-zero despite the three relevant setup cases passing.
- Files touched: `src/managed-restart.ts`, `src/backend/supervisor-http-server.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-setup-page.ts`, `src/cli/supervisor-runtime.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard-browser-smoke.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low to medium; the behavior is intentionally constrained behind an explicit env-gated capability, but future launcher installers should set the managed-restart env vars only for WebUI processes that are actually supervised for automatic relaunch.
- Last focused command: `./node_modules/.bin/tsx --test src/backend/webui-dashboard-browser-smoke.test.ts --test-name-pattern 'browser smoke completes the first-run setup flow through the narrow config API|browser smoke reports when a setup save is already effective|browser smoke enables launcher-managed restart only when capability is present'`
- Exact failure reproduced: the setup UI had no typed runtime capability or guarded restart command, so `Restart now` stayed disabled for every runtime and there was no safe path to allow automatic restart only for launcher-backed sessions.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1055/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1055/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "managed restart|restart now|restartRequired|restartScope|restartTriggeredByFields|launcher|setup-config|managedRestart|restart capability|restartCapability|restartSupported|restart support" src test docs -g '!dist'`; `sed -n '1,220p' src/backend/supervisor-http-server.ts`; `sed -n '1,260p' src/supervisor/supervisor-service.ts`; `sed -n '1,260p' src/backend/webui-setup-browser-script.ts`; `rg -n "restart|launcher|process manager|pm2|systemd|forever|daemon|respawn|self-terminate|terminate|exit\\(|SIGTERM|restart capability|managed" src -g '!dist'`; `sed -n '1,320p' src/cli/supervisor-runtime.ts`; `sed -n '1,260p' src/supervisor/supervisor.ts`; `sed -n '1040,1385p' src/backend/supervisor-http-server.test.ts`; `sed -n '620,710p' src/backend/webui-setup-page.ts`; `sed -n '1,220p' src/setup-config-write.ts`; `sed -n '1,220p' src/backend/webui-dashboard.test.ts`; `sed -n '1,220p' src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '220,340p' src/backend/webui-setup-browser-script.ts`; `sed -n '1880,2285p' src/backend/webui-dashboard.test.ts`; `sed -n '188,620p' src/backend/supervisor-http-server.test.ts`; `sed -n '40,90p' docs/validation-checklist.md`; `sed -n '1,240p' src/supervisor/supervisor-service.test.ts`; `sed -n '1,220p' scripts/install-launchd.sh`; `sed -n '1,220p' scripts/install-systemd.sh`; `sed -n '1,220p' launchd/io.codex.supervisor.plist.template`; `sed -n '1,220p' systemd/codex-supervisor.service.template`; `sed -n '1,220p' scripts/run-loop.sh`; `sed -n '360,470p' src/backend/webui-dashboard.test.ts`; `apply_patch ...`; `npx tsx --test src/backend/supervisor-http-server.test.ts --test-name-pattern "managed restart|setup config|setup-readiness"`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell"`; `npx tsc -p tsconfig.json --noEmit`; `npm run test:webui-smoke -- --test-name-pattern "browser smoke completes the first-run setup flow through the narrow config API|browser smoke reports when a setup save is already effective|browser smoke enables launcher-managed restart only when capability is present"`; `npm run build`; `npm ci`; `npm run build`; `./node_modules/.bin/tsx --test src/backend/webui-dashboard-browser-smoke.test.ts --test-name-pattern 'browser smoke completes the first-run setup flow through the narrow config API|browser smoke reports when a setup save is already effective|browser smoke enables launcher-managed restart only when capability is present'`.
- PR status: none yet for `codex/issue-1055`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
