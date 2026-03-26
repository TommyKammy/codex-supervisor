# Issue #1065: Finish setup-shell reconnect UX after launcher-managed restart

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1065
- Branch: codex/issue-1065
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2159cbcd6ec5297a3ab7dadad6e4ce7d7e1650f9
- Blocked reason: none
- Last failure signature: missing-local-toolchain
- Repeated failure signature count: 0
- Updated at: 2026-03-26T13:48:20.000Z

## Latest Codex Summary
- Added setup-shell reconnect polling after launcher-managed restart acceptance so `/setup` revalidates readiness until the worker returns, clears stale restart-required presentation once the worker is back, and updates the launcher-managed setup copy to reflect that the shell stays available during reconnect.

## Active Failure Context
- `npm run build` currently fails in this worktree because the local `tsc` binary is missing (`sh: 1: tsc: not found`).
- The targeted Playwright smoke command currently fails in this worktree because `playwright-core` is not installed locally (`Cannot find module 'playwright-core'`).

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining setup-shell UX gap after launcher-managed restart is in the `/setup` browser script, not in the restartable shell service itself; polling `/api/setup-readiness` after restart acceptance and using an explicit restart capability phase should let the surviving shell converge out of stale restart-required UI without a manual refresh.
- What changed: added `state` to the managed-restart capability DTO, marked restartable-shell capability state as `reconnecting` while the worker is down, taught the setup browser script to poll readiness after managed restart acceptance until the worker returns, updated managed-restart setup copy to say the WebUI shell stays available, and added focused setup/unit plus HTTP/runtime regression coverage for the reconnect path.
- Current blocker: environment-only verification gaps remain. Focused unit and HTTP/runtime tests pass, but the live browser smoke cannot run here without local `playwright-core`, and `npm run build` still cannot run to completion without a local `tsc`.
- Next exact step: commit the reconnect UX checkpoint, then either restore/install the missing local dependencies (`typescript`/`playwright-core` in this worktree) or use the repo’s normal bootstrap path, rerun the targeted browser smoke and `npm run build`, and open/push the draft PR for `codex/issue-1065`.
- Verification gap: `src/backend/webui-dashboard-browser-smoke.test.ts` remains unverified in this worktree because `playwright-core` is missing locally, and `npm run build` remains unverified because the `tsc` executable is missing locally.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/managed-restart.ts`; `src/backend/restartable-webui-shell-service.ts`; `src/backend/webui-setup-browser-script.ts`; `src/backend/webui-dashboard.test.ts`; `src/backend/webui-dashboard-browser-smoke.test.ts`; `src/backend/restartable-webui-shell-service.test.ts`; `src/backend/supervisor-http-server.test.ts`.
- Rollback concern: medium-low. The behavior change is localized to setup-shell restart handling, but it introduces active polling after restart acceptance, so regressions would likely appear as extra `/api/setup-readiness` requests or stale restart UI not clearing.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory/journal files, traced the setup-shell managed restart flow, added a reconnect-specific setup regression test before changing behavior, implemented readiness polling plus structured restart phase tracking, updated stale launcher-managed setup copy, reran focused restart-related tests, and captured the local environment verification failures.
- Exact failure reproduced this turn: `npm run build` fails with `sh: 1: tsc: not found`, and the targeted Playwright smoke fails with `Cannot find module 'playwright-core'`.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "managed-restart|restart required|setup-shell|/setup|Restart required|worker reconnect|launcher-managed" src test tests`; `rg --files | rg "setup|restart|shell|managed"`; `node -p "const p=require('./package.json'); ({scripts:p.scripts, devDependencies: Object.keys(p.devDependencies||{}).filter(k=>/playwright|vitest|tsx|jest/.test(k))})"`; `sed -n '2320,2525p' src/backend/webui-dashboard.test.ts`; `sed -n '1360,1445p' src/backend/supervisor-http-server.test.ts`; `sed -n '520,710p' src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '1,520p' src/backend/webui-setup-browser-script.ts`; `sed -n '1,380p' src/backend/restartable-webui-shell-service.ts`; `sed -n '1,260p' src/backend/webui-dashboard.test.ts`; `sed -n '260,520p' src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '170,235p' src/backend/supervisor-http-server.ts`; `sed -n '1,220p' src/setup-readiness.ts`; `sed -n '1,180p' src/setup-config-write.ts`; `sed -n '1,220p' src/managed-restart.ts`; `apply_patch ...`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell (enables launcher-managed restart only when the runtime capability is available|refreshes readiness after launcher-managed restart until the worker reconnects)"`; `npx tsx --test src/backend/supervisor-http-server.test.ts --test-name-pattern "createSupervisorHttpServer (only accepts managed restart commands when launcher support is available|keeps setup routes reachable while the worker is reconnecting)"`; `npx tsx --test src/backend/restartable-webui-shell-service.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts --test-name-pattern "browser smoke enables launcher-managed restart only when capability is present"`; `npm run build`; `gh pr view --json number,state,isDraft,headRefName,baseRefName,url`; `git diff --stat`.
- PR status: no PR yet for `codex/issue-1065`
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local
