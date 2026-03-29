# Issue #1180: Serialize Web run-once behind the supervisor cycle lock

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1180
- Branch: codex/issue-1180
- Workspace: .
- Journal: .codex-supervisor/issues/1180/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: e6dd607582ab7c48cfdaf3f37031b22085a3c148
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-29T09:14:29.763Z

## Latest Codex Summary
Wired the WebUI `run-once` endpoint through the loop controller so it now uses the same supervisor-cycle lock boundary as CLI `run-once`/`loop`. That keeps the existing JSON shape, and lock contention now comes back through the existing summary path as the skip message instead of allowing overlapping mutation cycles. I also updated Web runtime startup to require and pass the loop controller, and added focused coverage for concurrent HTTP requests plus the new Web runtime wiring.

Committed on `codex/issue-1180` as `e6dd607` (`Serialize Web run-once through cycle lock`) and opened draft PR #1181: https://github.com/TommyKammy/codex-supervisor/pull/1181

Summary: Web `run-once` now executes through the supervisor cycle lock, with focused tests covering concurrent requests and Web runtime wiring.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/supervisor/supervisor-loop-controller.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npx tsx --test src/cli/entrypoint.test.ts`
Next action: Open or update a draft PR for branch `codex/issue-1180` with commit `e6dd607`.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The WebUI `run-once` route bypassed `acquireSupervisorLock()` by calling `service.runOnce()` directly, allowing overlapping Web-triggered mutation cycles.
- What changed: Added optional `loopController` wiring to the HTTP server, switched Web `run-once` to `loopController.runCycle("run-once", ...)`, required a loop controller for `web` runtime startup, added focused tests for concurrent Web `run-once` requests plus runtime/entrypoint wiring, pushed branch `codex/issue-1180`, and opened draft PR #1181.
- Current blocker: none
- Next exact step: Monitor draft PR #1181 for CI or review feedback and address any follow-up if it appears.
- Verification gap: none for the focused issue verification set.
- Files touched: .codex-supervisor/issues/1180/issue-journal.md, src/backend/supervisor-http-server.ts, src/backend/supervisor-http-server.test.ts, src/cli/supervisor-runtime.ts, src/cli/supervisor-runtime.test.ts, src/cli/entrypoint.ts, src/cli/entrypoint.test.ts
- Rollback concern: The WebUI `run-once` endpoint now fails closed if the server is constructed without a loop controller; runtime wiring was updated so normal `web` startup still provides one.
- Last focused command: gh pr create --draft --base main --head codex/issue-1180 --title "Serialize Web run-once behind the supervisor cycle lock" --body ...
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
