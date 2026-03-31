# Issue #1236: [codex] Extract shared WebUI local CI browser-script helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1236
- Branch: codex/issue-1236
- Workspace: .
- Journal: .codex-supervisor/issues/1236/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 078fa3c6cbfb048a2f1add3c4d8d0ae7537f6729
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T01:52:32.770Z

## Latest Codex Summary
- Extracted shared browser-safe helpers for local CI presentation and authenticated mutation POST handling, then rewired setup and dashboard WebUI scripts to inject those helpers instead of carrying duplicate inline logic.
- Added focused regression coverage for the shared helper boundary and reran the requested WebUI/server tests successfully.
- Installed the declared dev dependencies in this worktree so `npm run build` could run, then completed the build successfully.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The duplicated setup/dashboard browser-script logic can be reduced safely by injecting one shared helper boundary for local CI wording and authenticated mutation handling without changing operator-visible behavior.
- What changed: Added `src/backend/webui-browser-script-helpers.ts` plus `src/backend/webui-browser-script-helpers.test.ts`; updated `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, and `src/backend/webui-setup-browser-script.ts` to use the shared helpers. Kept dashboard browser `buildStatusLines` as an injected local wrapper so stringified browser code does not depend on ESM import shims.
- Current blocker: None.
- Next exact step: Commit the helper extraction and journal update on `codex/issue-1236`.
- Verification gap: None currently identified. Focused tests and build both passed after installing the declared dev dependencies in this worktree.
- Files touched: `.codex-supervisor/issues/1236/issue-journal.md`, `src/backend/webui-browser-script-helpers.ts`, `src/backend/webui-browser-script-helpers.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-setup-browser-script.ts`
- Rollback concern: Low. The main risk is browser-script injection ordering because helper functions are stringified into inline scripts; the new helper test and dashboard/setup harness tests exercise that path.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
