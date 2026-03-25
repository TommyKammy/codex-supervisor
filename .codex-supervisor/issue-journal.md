# Issue #957: WebUI can falsely report loop mode is off while supervisor loop is running

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/957
- Branch: codex/issue-957
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e2ade43f36c3b5cfe705d591323d546467d23180
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T01:37:13.000Z

## Latest Codex Summary
- Reproduced the false WebUI loop-off state with focused dashboard tests, then replaced the hardcoded shell copy with typed rendering driven by a new `loopRuntime` status field.
- Added a long-lived supervisor loop-runtime lock held for the lifetime of the `loop` command and inspected that lock from `statusReport` so `/api/status` reports live loop state without guessing from issue selection.
- Focused verification passed for the dashboard, supervisor status, CLI runtime, HTTP, service, browser smoke, and build paths after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the dashboard shell hardcoded loop-off copy instead of rendering from a typed live runtime signal, so the UI could contradict a running supervisor loop between refreshes.
- What changed: added `src/supervisor/supervisor-loop-runtime-state.ts` to manage and inspect a long-lived loop-runtime lock; exposed `loopRuntime` on `SupervisorStatusDto`; held the runtime lock for the lifetime of the `loop` CLI command; replaced hardcoded dashboard loop-off shell copy with typed elements rendered from `/api/status`; added focused regressions for loop-running and loop-off dashboard states plus a supervisor status-runtime regression.
- Current blocker: none.
- Next exact step: stage the loop-runtime/dashboard changes, commit them on `codex/issue-957`, and continue with broader verification or PR prep.
- Verification gap: none in the requested scope after restoring local dependencies with `npm ci`.
- Files touched: `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-browser-smoke.test.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard-panel-layout.ts`, `src/backend/webui-dashboard.test.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-loop-controller.ts`, `src/supervisor/supervisor-loop-runtime-state.ts`, `src/supervisor/supervisor-service.test.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: moderate; the runtime lock is intentionally long-lived for `loop` processes, so regressions would most likely show up as false loop-running state or loop startup refusal if the lock path/cleanup behavior is wrong.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`
- PR status: no PR opened from `codex/issue-957` yet in this turn.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
