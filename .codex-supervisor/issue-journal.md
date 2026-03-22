# Issue #847: WebUI visual refresh: apply a cleaner Asana-inspired dashboard presentation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/847
- Branch: codex/issue-847
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7d437698de92c694798d5dc2de299fb9f2cc1f06
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T21:40:05Z

## Latest Codex Summary
- Reproduced the visual-refresh gap with a focused dashboard HTML regression that expected labeled hero and section framing, then refreshed the page chrome and flatter panel styling without changing browser-side behavior or backend contracts.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining issue-847 gap is page-level framing rather than data behavior, so a focused hero-and-section regression can drive a cleaner dashboard hierarchy while keeping all existing panel ids, command hooks, and SSE/status rendering intact.
- What changed: added a focused failing regression in `src/backend/webui-dashboard.test.ts` that expected a labeled hero shell plus overview/details section chrome; refreshed `src/backend/webui-dashboard-page.ts` with flatter Asana-inspired surfaces, a structured hero body/summary, section headers, cleaner badge cards, and lighter panel/action/event treatments without changing any browser-script ids or backend endpoints.
- Current blocker: none
- Next exact step: monitor draft PR `#857` for CI and review feedback, then address any follow-up needed on the dashboard refresh.
- Verification gap: none on the focused issue scope; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` passed after the refresh.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the change is isolated to WebUI dashboard markup/CSS plus one rendering regression and preserves existing browser-script ids plus command endpoints.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`
- Last focused failure: none.
- Last focused commands:
```bash
date -u +%Y-%m-%dT%H:%M:%SZ
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-847/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-847/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg --files src/backend | rg 'webui-dashboard|dashboard'
sed -n '1,340p' src/backend/webui-dashboard-page.ts
sed -n '1,340p' src/backend/webui-dashboard-panel-layout.ts
sed -n '1,280p' src/backend/webui-dashboard.test.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.test.ts
rg -n "panel-shell|hero|badge|detail-card|action-grid|renderSupervisorDashboardPage|Asana|panel-header|panel-subtitle|shortcut-button|action-card" src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-page.ts src/backend/webui-dashboard-panel-layout.ts
sed -n '280,620p' src/backend/webui-dashboard.test.ts
sed -n '340,760p' src/backend/webui-dashboard-page.ts
sed -n '1,220p' src/backend/webui-dashboard.ts
rg -n "renderSupervisorDashboardPage|hero-bar|section-label|overview-grid|details-grid|data-dashboard-root|aria-label=\"overview\"|aria-label=\"details\"" src/backend
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
git status --short --branch
git diff -- src/backend/webui-dashboard-page.ts src/backend/webui-dashboard.test.ts
```
### Scratchpad
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
