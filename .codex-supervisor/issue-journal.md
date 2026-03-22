# Issue #849: WebUI layout persistence: save and safely restore panel order in the browser

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/849
- Branch: codex/issue-849
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 60684654002d8839c21aa011398efbbf76e577de
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T23:04:46Z

## Latest Codex Summary
Reproduced the missing browser persistence with a new reload regression in `src/backend/webui-dashboard.test.ts`: a drag reorder survived within one runtime but reset after a fresh harness with the same `localStorage`.

Implemented browser-local panel layout persistence by restoring a saved order from `localStorage`, normalizing it against the current typed registry, and persisting the normalized order after layout renders. Added focused browser-logic coverage for restore, merge, and invalid-storage fallback.

Summary: Added safe browser-local dashboard panel layout persistence, pushed `codex/issue-849`, and opened draft PR `#859`
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
Failure signature: none
Next action: monitor PR `#859` for CI and review feedback

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: browser-local persistence only needs a typed order payload plus strict normalization on restore, so a small storage wrapper around the existing panel-order logic should satisfy reload persistence without introducing brittle state coupling.
- What changed: added `restoreDashboardPanelOrder()` and `serializeDashboardPanelOrder()` in `src/backend/webui-dashboard-browser-logic.ts`; wired `src/backend/webui-dashboard-browser-script.ts` to read/write `window.localStorage` with guarded access and to persist the normalized order after rendering; extended `src/backend/webui-dashboard-browser-logic.test.ts` to cover restore, merge, and invalid-storage fallback; and added a runtime reload regression in `src/backend/webui-dashboard.test.ts` using a shared fake browser storage.
- Current blocker: none
- Next exact step: monitor CI and review feedback on PR `#859`, then address any follow-up if needed.
- Verification gap: none on the focused persistence scope; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed after the storage restore/persist helpers and reload regression were added.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the behavior change is browser-local only and falls back to the default typed layout if storage is missing, malformed, or outdated.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
- Last focused failure: none.
- Last focused commands:
```bash
sed -n '1,220p' "$HOME/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-849/AGENTS.generated.md"
sed -n '1,220p' "$HOME/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-849/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "localStorage|sessionStorage|panel layout|dashboard panel|DEFAULT_DASHBOARD_PANEL_LAYOUT|normalizeDashboardPanelLayout|applyDashboardPanelDrop|saved layout|storage" src/backend
sed -n '1,260p' src/backend/webui-dashboard-panel-layout.ts
sed -n '1,360p' src/backend/webui-dashboard-browser-logic.test.ts
sed -n '1,760p' src/backend/webui-dashboard.test.ts
sed -n '1,280p' src/backend/webui-dashboard-browser-script.ts
sed -n '820,1040p' src/backend/webui-dashboard-browser-script.ts
sed -n '1,240p' src/backend/webui-dashboard-browser-logic.ts
tail -n 120 src/backend/webui-dashboard-browser-script.ts
rg -n "renderPanelLayout\\(|wirePanelDragAndDrop\\(|refreshStatusAndDoctor\\(|wireEvents\\(" src/backend/webui-dashboard-browser-script.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
git rev-parse HEAD
git status --short --branch
```
### Scratchpad
- 2026-03-22T23:04:46Z: committed the persistence checkpoint as `6068465`, pushed `codex/issue-849`, and opened draft PR `#859`.
- 2026-03-22T23:03:27Z: reproduced the missing reload persistence with a shared-storage dashboard regression, added guarded localStorage restore/persist helpers for the typed panel order, added focused restore/fallback unit coverage, and reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`.
- 2026-03-22T22:37:34Z: fixed the CodeRabbit review threads locally by rejecting cross-lane panel drops before mutating browser layout state, adding a focused cross-lane drag regression, sanitizing workstation-local paths from the issue journal, and rerunning `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`.
- 2026-03-22T22:21:32Z: reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, pushed `codex/issue-848`, and opened draft PR `#858` for the drag-reorder checkpoint.
- 2026-03-22T22:09:23Z: reproduced the drag-reorder gap with a pure browser-logic regression, then added draggable panel handles, browser-only DOM reorder state, and a runtime dashboard drag test; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
