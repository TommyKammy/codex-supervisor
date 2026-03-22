# Issue #848: WebUI drag-and-drop: reorder dashboard panels through typed browser layout state

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/848
- Branch: codex/issue-848
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0bb69b077b67ee2b11efe3d1dcc55c3ca0c76ac0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T22:04:04.239Z

## Latest Codex Summary
- Reproduced the missing drag-and-drop behavior with a focused browser-logic regression, then wired explicit panel drag handles plus browser-only DOM reordering through the typed panel order model without touching backend endpoints.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the typed panel order model is already sufficient for drag reorder if the browser gets a narrow reorder helper plus explicit handle markup and only mutates in-page DOM order inside the existing overview/details lanes.
- What changed: added a focused failing regression in `src/backend/webui-dashboard-browser-logic.test.ts` for typed panel drops; implemented `normalizeDashboardPanelOrder` and `applyDashboardPanelDrop`; updated panel shells to render draggable handle buttons with stable ids; wired the inline browser script to keep browser-local panel order state and reorder DOM nodes on drop; and extended `src/backend/webui-dashboard.test.ts` with handle markup coverage plus a runtime drag-reorder regression.
- Current blocker: none
- Next exact step: commit the verified drag-reorder checkpoint on `codex/issue-848`, then open or update the draft PR for this branch so CI can validate the WebUI-only change.
- Verification gap: none on the focused issue scope; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed locally after the drag-reorder wiring.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard-panel-layout.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the change is isolated to browser helper logic, panel shell markup/CSS, and client-side DOM ordering while leaving existing dashboard data fetches and safe command endpoints unchanged.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
- Last focused failure: none.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-848/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-848/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
rg --files src/backend | rg 'webui-dashboard|dashboard'
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.test.ts
sed -n '1,320p' src/backend/webui-dashboard-panel-layout.ts
sed -n '1,360p' src/backend/webui-dashboard-page.ts
sed -n '361,760p' src/backend/webui-dashboard-page.ts
sed -n '1,320p' src/backend/webui-dashboard-browser-logic.ts
sed -n '1,360p' src/backend/webui-dashboard-browser-script.ts
sed -n '361,760p' src/backend/webui-dashboard-browser-script.ts
sed -n '1,340p' src/backend/webui-dashboard.test.ts
sed -n '340,760p' src/backend/webui-dashboard.test.ts
sed -n '760,1160p' src/backend/webui-dashboard.test.ts
rg -n "layout|drag|drop|reorder|data-panel-id|panel-drag-slot|drag-slot" src/backend/webui-dashboard-*
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
git status --short --branch
git diff -- src/backend/webui-dashboard-browser-logic.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard-page.ts src/backend/webui-dashboard-panel-layout.ts src/backend/webui-dashboard.test.ts
```
### Scratchpad
- 2026-03-22T22:09:23Z: reproduced the drag-reorder gap with a pure browser-logic regression, then added draggable panel handles, browser-only DOM reorder state, and a runtime dashboard drag test; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
