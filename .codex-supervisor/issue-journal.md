# Issue #1052: Split the persistent WebUI shell from worker lifecycle as a long-term follow-up

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1052
- Branch: codex/issue-1052
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9e09f35378dd681b8f0b882f9ff509d5bc1384c8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T10:16:27.408Z

## Latest Codex Summary
- Added a restartable WebUI shell/worker boundary so launcher-managed restart keeps the HTTP shell alive while the supervisor worker is recreated behind it.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue `#1052` was still unimplemented on `9e09f35`; the WebUI `web` runtime closed the only HTTP server on managed restart, so the shell could never survive a worker restart window. A restartable shell host that caches read models and swaps `SupervisorService` instances behind the same listener is enough to prove the split without broad refactors.
- What changed: added `src/backend/restartable-webui-shell-service.ts` to own the shell/worker boundary, cached read-only shell data during worker restart, and forward event subscriptions across worker swaps; changed `src/cli/supervisor-runtime.ts` to build that shell host for launcher-managed WebUI sessions and restart the worker via a recreated service instead of calling `stopWebServer()`; threaded `createWebUiService` from `src/cli/entrypoint.ts`; and factored `readManagedRestartCapabilityFromEnv()` out of `src/managed-restart.ts` so runtime can reuse the launcher capability without the old stop-the-process behavior.
- Current blocker: none locally.
- Next exact step: monitor draft PR `#1062` for CI on `c9a9000`, then address any review or verification follow-up around the reconnecting shell path.
- Verification gap: no browser-smoke or manual browser pass yet for the new reconnecting shell path; the focused runtime/HTTP tests and `npm run build` are green locally.
- Files touched: `src/backend/restartable-webui-shell-service.ts`, `src/cli/supervisor-runtime.ts`, `src/cli/entrypoint.ts`, `src/managed-restart.ts`, `src/cli/supervisor-runtime.test.ts`, `src/backend/supervisor-http-server.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: moderate-low. The new shell host is isolated to `web` command managed-restart sessions, but it now caches read-only data and recreates `SupervisorService` instances, so rollback would mainly mean restoring the prior stop-the-server path.
- Last focused command: `npx tsx --test src/cli/supervisor-runtime.test.ts --test-name-pattern "runSupervisorCommand keeps the WebUI shell up after a managed restart request until an explicit stop arrives" src/backend/supervisor-http-server.test.ts --test-name-pattern "createSupervisorHttpServer keeps setup routes reachable while the worker is reconnecting"`
- What changed this turn: reproduced the failure with a new runtime test that showed `managed restart requested, shutting down WebUI for relaunch`; implemented the restartable shell/worker split for launcher-managed WebUI sessions; and added an HTTP-level regression proving `/setup` and cached `/api/setup-readiness` remain reachable while the worker is reconnecting.
- Exact failure reproduced this turn: `runSupervisorCommand(... web ...)` closed the only HTTP server immediately after `/api/commands/managed-restart` accepted, so the shell dropped before any reconnecting/restarting state could be surfaced.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1052/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1052/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 12`; `rg -n "managed restart|worker restart|worker unavailable|reconnect|reconnecting|shell" src test docs README.md -g '!dist'`; `rg --files src | rg 'webui|managed-restart|supervisor-runtime|worker'`; `sed -n '1,260p' src/cli/supervisor-runtime.ts`; `sed -n '1,260p' src/backend/supervisor-http-server.ts`; `sed -n '1200,1335p' src/backend/supervisor-http-server.test.ts`; `sed -n '1,220p' src/managed-restart.ts`; `rg -n "createSupervisorHttpServer\\(|runSupervisorCommand\\(|command === \\\"web\\\"|managedRestart" src -g '!dist'`; `sed -n '1,260p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,220p' docs/operator-dashboard.md`; `sed -n '1,220p' scripts/run-web.sh`; `sed -n '1,160p' src/cli/entrypoint.ts`; `sed -n '150,230p' src/backend/webui-dashboard-browser-logic.ts`; `sed -n '620,700p' src/backend/webui-dashboard-browser-logic.ts`; `rg -n "class SupervisorSseEventStream|subscribeEvents|events.connect|handleRequest" src/backend/supervisor-http-server.ts`; `sed -n '260,520p' src/backend/supervisor-http-server.ts`; `sed -n '520,780p' src/backend/supervisor-http-server.ts`; `rg -n "process\\.env|CODEX_SUPERVISOR_MANAGED_RESTART|t\\.after\\(|mock\\.method\\(process" src/cli/supervisor-runtime.test.ts src/managed-restart.test.ts`; `sed -n '1,220p' src/managed-restart.test.ts`; `apply_patch ...`; `npx tsx --test src/cli/supervisor-runtime.test.ts --test-name-pattern "runSupervisorCommand keeps the WebUI shell up after a managed restart request until an explicit stop arrives"`; `rg -n "warning:\\s*\\{|interface SupervisorStatusDto|type SupervisorStatusWarning|warning\\?:" src/supervisor/supervisor-status-report.ts src/supervisor -g '!dist'`; `sed -n '1,220p' src/supervisor/supervisor-status-report.ts`; `sed -n '1,140p' src/doctor.ts`; `npm run build`; `cat package.json`; `ls node_modules/.bin | rg 'tsc|tsx'`; `npx tsc -p tsconfig.json`; `ls package-lock.json`; `npm ci`; `npm run build`; `npx tsx --test src/cli/supervisor-runtime.test.ts --test-name-pattern "runSupervisorCommand keeps the WebUI shell up after a managed restart request until an explicit stop arrives" src/backend/supervisor-http-server.test.ts --test-name-pattern "createSupervisorHttpServer keeps setup routes reachable while the worker is reconnecting"`; `git diff --stat`; `tail -n 120 .codex-supervisor/issue-journal.md`; `git diff -- src/cli/supervisor-runtime.ts src/cli/entrypoint.ts src/managed-restart.ts src/backend/supervisor-http-server.test.ts src/cli/supervisor-runtime.test.ts src/backend/restartable-webui-shell-service.ts`.
- PR status: draft PR `#1062` open at `https://github.com/TommyKammy/codex-supervisor/pull/1062`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local
