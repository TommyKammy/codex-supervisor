# Issue #1390: Refactor: split dashboard DOM event wiring and action dispatch from browser script

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1390
- Branch: codex/issue-1390
- Workspace: .
- Journal: .codex-supervisor/issues/1390/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: cc79d4f291ad79061b2486b1ca7b6f67cc7511f5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T07:47:22.850Z

## Latest Codex Summary
- Added focused unit coverage for extracted dashboard browser control and interaction seams, then refactored the dashboard browser script to delegate mutation/action dispatch and DOM/SSE wiring to dedicated helper modules.
- Verified the focused dashboard/server suite and `npm run build` after fixing inline helper serialization issues caused by named arrow functions and imported helper aliases inside injected browser code.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `webui-dashboard-browser-script.ts` can stay behaviorally stable if command dispatch and DOM/SSE registration are extracted behind injected helper functions that only depend on explicit browser-script callbacks.
- What changed: Added `webui-dashboard-browser-controls.ts` and `webui-dashboard-browser-interactions.ts` plus focused tests; rewired `webui-dashboard-browser-script.ts` to use those helpers instead of inline command/event registration logic; fixed injected-script compatibility by avoiding named-arrow serialization pitfalls and by passing `postMutationJsonWithAuth` explicitly into the control layer.
- Current blocker: none
- Next exact step: Stage the refactor/test files and create a checkpoint commit on `codex/issue-1390`.
- Verification gap: none for local focused verification; full repo test sweep was not run beyond the issue-specific suite and build.
- Files touched: `.codex-supervisor/issues/1390/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-browser-controls.ts`, `src/backend/webui-dashboard-browser-controls.test.ts`, `src/backend/webui-dashboard-browser-interactions.ts`, `src/backend/webui-dashboard-browser-interactions.test.ts`
- Rollback concern: The browser script still relies on helper `toString()` injection, so future extracted helpers must avoid capturing module-local import aliases or compiler-inserted named-arrow wrappers that do not survive inline serialization.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|action|refresh|event|dispatch'`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-09: Focused extraction landed and local verification passed; `npm run build` also passed.
