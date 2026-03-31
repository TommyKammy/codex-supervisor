# Issue #1236: [codex] Extract shared WebUI local CI browser-script helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1236
- Branch: codex/issue-1236
- Workspace: .
- Journal: .codex-supervisor/issues/1236/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: bfce22a65a9a3cebf251a397b4669059e67e334b
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-31T02:03:22.993Z

## Latest Codex Summary
Extracted the shared WebUI browser-script helper boundary into [webui-browser-script-helpers.ts](src/backend/webui-browser-script-helpers.ts) and added focused coverage in [webui-browser-script-helpers.test.ts](src/backend/webui-browser-script-helpers.test.ts). Setup and dashboard now reuse the same local CI presentation rules and authenticated mutation POST handling through [webui-setup-browser-script.ts](src/backend/webui-setup-browser-script.ts), [webui-dashboard-browser-script.ts](src/backend/webui-dashboard-browser-script.ts), and [webui-dashboard-browser-logic.ts](src/backend/webui-dashboard-browser-logic.ts). I kept the dashboard’s browser `buildStatusLines` as a local injected wrapper so the inline script does not depend on module import shims at runtime.

Re-ran focused verification with `npx tsx --test src/backend/webui-browser-script-helpers.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`, both of which passed again. Pushed `codex/issue-1236` to `github` at `bfce22a` and opened draft PR #1238: https://github.com/TommyKammy/codex-supervisor/pull/1238.

Summary: Verification is green for the shared browser-helper refactor, the branch is pushed, and draft PR #1238 now tracks review/CI.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-browser-script-helpers.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`; `npm run build`
Next action: Monitor PR #1238 for CI and review feedback, then address any follow-up on `codex/issue-1236`.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The duplicated setup/dashboard browser-script logic can be reduced safely by injecting one shared helper boundary for local CI wording and authenticated mutation handling without changing operator-visible behavior.
- What changed: Added `src/backend/webui-browser-script-helpers.ts` plus `src/backend/webui-browser-script-helpers.test.ts`; updated `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, and `src/backend/webui-setup-browser-script.ts` to use the shared helpers. Kept dashboard browser `buildStatusLines` as an injected local wrapper so stringified browser code does not depend on ESM import shims.
- Current blocker: None.
- Next exact step: Watch PR #1238, inspect CI once checks report, and address any review or failure feedback.
- Verification gap: None currently identified. Focused tests and build both passed after installing the declared dev dependencies in this worktree.
- Files touched: `.codex-supervisor/issues/1236/issue-journal.md`, `src/backend/webui-browser-script-helpers.ts`, `src/backend/webui-browser-script-helpers.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-setup-browser-script.ts`
- Rollback concern: Low. The main risk is browser-script injection ordering because helper functions are stringified into inline scripts; the new helper test and dashboard/setup harness tests exercise that path.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1236 --title "[codex] Extract shared WebUI local CI browser-script helpers" ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
