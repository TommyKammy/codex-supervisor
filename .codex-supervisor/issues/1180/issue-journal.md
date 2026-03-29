# Issue #1180: Serialize Web run-once behind the supervisor cycle lock

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1180
- Branch: codex/issue-1180
- Workspace: .
- Journal: .codex-supervisor/issues/1180/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 536f8abccbab6d9caec9b61d3337a398acbedcd6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-29T09:06:05.551Z

## Latest Codex Summary
- Routed WebUI `POST /api/commands/run-once` through the supervisor loop controller so Web-triggered cycles use the same supervisor-cycle lock boundary as CLI `run-once`/`loop`. Added focused HTTP and runtime coverage for serialized concurrent Web requests and Web runtime loop-controller wiring.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The WebUI `run-once` route bypassed `acquireSupervisorLock()` by calling `service.runOnce()` directly, allowing overlapping Web-triggered mutation cycles.
- What changed: Added optional `loopController` wiring to the HTTP server, switched Web `run-once` to `loopController.runCycle("run-once", ...)`, required a loop controller for `web` runtime startup, and added focused tests for concurrent Web `run-once` requests plus runtime/entrypoint wiring.
- Current blocker: none
- Next exact step: Commit the focused lock-boundary fix and leave the branch ready for PR/update flow.
- Verification gap: none for the focused issue verification set.
- Files touched: .codex-supervisor/issues/1180/issue-journal.md, src/backend/supervisor-http-server.ts, src/backend/supervisor-http-server.test.ts, src/cli/supervisor-runtime.ts, src/cli/supervisor-runtime.test.ts, src/cli/entrypoint.ts, src/cli/entrypoint.test.ts
- Rollback concern: The WebUI `run-once` endpoint now fails closed if the server is constructed without a loop controller; runtime wiring was updated so normal `web` startup still provides one.
- Last focused command: npx tsx --test src/backend/supervisor-http-server.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
