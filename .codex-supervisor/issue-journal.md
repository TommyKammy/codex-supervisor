# Issue #1070: Expose inventory degradation provenance and recovery posture to operators

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1070
- Branch: codex/issue-1070
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 8fa62a81c56953abcc4e90be0e2a5a46529b1868
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T23:17:49Z

## Latest Codex Summary
- Added structured inventory posture reporting so status and WebUI can distinguish healthy full inventory, targeted degraded reconciliation, and snapshot-only degraded support.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: operator-facing inventory posture needed a typed status object plus a single explicit posture line so both CLI status and the WebUI can prioritize degraded inventory correctly.
- What changed: added `InventoryOperatorStatus` helpers, threaded `inventoryStatus` through `statusReport()`, emitted an `inventory_posture=...` line, and taught the dashboard overview/attention helpers to prefer degraded inventory posture over raw runnable counts.
- Current blocker: none.
- Next exact step: commit the inventory posture changes on `codex/issue-1070`, then rerun broader verification once the workspace has a local TypeScript compiler available.
- Verification gap: `npm run build` cannot complete in this workspace because `tsc` is not installed; focused status and dashboard tests are green.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/backend/webui-dashboard-browser-logic.test.ts`; `src/backend/webui-dashboard-browser-logic.ts`; `src/inventory-refresh-state.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `src/supervisor/supervisor-status-report.ts`; `src/supervisor/supervisor.ts`
- Rollback concern: moderate. A bad posture classifier could overstate degraded capabilities and make snapshot-backed readiness look more authoritative than it is.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts`
- What changed this turn: reread the required memory files and journal, identified that `statusReport()` only exposed inventory degradation as free-form lines and warnings, added focused failing tests for typed posture and dashboard prioritization, implemented typed operator posture/guidance, reran the focused suites, and attempted a broader TypeScript build.
- Exact failure reproduced this turn: before the fix, `statusReport().inventoryStatus` was undefined and the dashboard overview still reported runnable work as healthy even when inventory refresh was degraded and selection was blocked.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 12`; `rg -n "inventory_refresh|degraded|last_successful_inventory|snapshot|reconciliation_state|recovery" src test .`; `rg --files src | rg "supervisor|state-store|inventory|diagnostics|webui|status"`; `sed -n '1,260p' src/supervisor/supervisor-status-model.ts`; `sed -n '1,280p' src/supervisor/supervisor-status-rendering.ts`; `sed -n '1,320p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,320p' src/backend/webui-dashboard.test.ts`; `rg -n "inventory_refresh|inventory_snapshot|last_successful_inventory|fallback|degraded" src/supervisor src/backend`; `sed -n '1,260p' src/supervisor/supervisor-status-report.ts`; `sed -n '1,260p' src/backend/webui-dashboard.ts`; `sed -n '1,260p' src/backend/webui-dashboard-browser-logic.ts`; `sed -n '1,360p' src/supervisor/supervisor-selection-readiness-summary.ts`; `sed -n '760,980p' src/backend/webui-dashboard-browser-script.ts`; `rg -n "selectionSummary|warning|inventory_refresh|inventory_snapshot|last-known-good|degraded" src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard.test.ts`; `sed -n '640,760p' src/backend/webui-dashboard-browser-script.ts`; `sed -n '980,1080p' src/backend/webui-dashboard-browser-script.ts`; `sed -n '300,420p' src/backend/webui-dashboard.test.ts`; `sed -n '1,240p' src/inventory-refresh-state.ts`; `rg -n "inventory_refresh_failure|last_successful_inventory_snapshot|classification" src/core/types.ts src/core`; `sed -n '1,260p' src/core/types.ts`; `sed -n '980,1115p' src/supervisor/supervisor.ts`; `sed -n '1115,1205p' src/supervisor/supervisor.ts`; `sed -n '1,340p' src/backend/webui-dashboard-browser-logic.test.ts`; `sed -n '340,520p' src/backend/webui-dashboard-browser-logic.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts`; `npm run build`; `npx tsc -p tsconfig.json`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
