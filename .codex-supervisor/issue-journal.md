# Issue #784: Backend adapter MVP: add SSE event streaming over existing supervisor events

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/784
- Branch: codex/issue-784
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5016095410f77e514b35f06e54064a41a82b2f37
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T16:49:35.014Z

## Latest Codex Summary
- Added an SSE adapter at `/api/events` over existing typed supervisor events with a small in-memory replay buffer and heartbeat comments. `SupervisorService` now exposes an event subscription hook so the backend can stream supervisor events without changing CLI behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the right MVP is still a thin transport adapter. Keep replay buffering and heartbeat in the backend SSE layer while reusing existing `SupervisorEvent` emission from the supervisor domain.
- What changed: added `SupervisorService.subscribeEvents`, wired `createSupervisorService()` through a subscriber registry, and added `/api/events` SSE support with `Last-Event-ID` replay and heartbeat comments in `src/backend/supervisor-http-server.ts`. Added focused backend tests for JSON endpoints, SSE event delivery/replay, and heartbeats.
- Current blocker: none
- Next exact step: commit the SSE adapter checkpoint on `codex/issue-784`, then open or update the draft PR with the new backend transport coverage.
- Verification gap: `npm run build` required a local `npm ci` first because `tsc` was not installed in the worktree yet; after installing locked dependencies, the build passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-service.ts`, `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`
- Rollback concern: moving replay state into supervisor domain objects would blur the backend transport boundary and make future WebSocket work harder; keep transport buffering local to the HTTP adapter.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` before `npm ci`; no code failures remain after installing dependencies and rebuilding.
- Last focused commands:
```bash
npx tsx --test src/backend/supervisor-http-server.test.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- Updated at: 2026-03-21T17:00:28Z
