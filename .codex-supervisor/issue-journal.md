# Issue #1611: Surface loop-off as an active tracked-work blocker in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1611
- Branch: codex/issue-1611
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f41f26d8a64204deabe303ae5d85020589230f9c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-21T13:10:12.669Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The missing blocker lives at the derived status/explain layer: `loopRuntime.state=off` and non-done tracked records already exist, but no shared derivation turned them into an operator-facing blocker.
- What changed: Added a shared loop-off tracked-work blocker summary in read-only reporting, threaded it into status warnings and explain output, and updated WebUI summary builders so loop-off tracked work reads as blocked instead of idle.
- Current blocker: none
- Next exact step: Commit the checkpoint on `codex/issue-1611`, then open/update the draft PR if requested.
- Verification gap: `npm test -- ...` still fans out through the repo wrapper, so focused verification used `npx tsx --test` for the four target files plus a standalone `npm run build`.
- Files touched: .codex-supervisor/issue-journal.md; src/supervisor/supervisor-loop-runtime-state.ts; src/supervisor/supervisor-read-only-reporting.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/backend/webui-dashboard-browser-logic.ts; src/backend/webui-dashboard-browser-logic.test.ts; src/backend/webui-dashboard-browser-script.ts; src/backend/webui-dashboard-browser-issue-details.ts; src/backend/webui-dashboard.test.ts
- Rollback concern: Low. The main behavior change is additional loop-off blocker derivation on read-only surfaces when non-done tracked work exists; tests cover status, explain, and WebUI summaries.
- Last focused command: npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
