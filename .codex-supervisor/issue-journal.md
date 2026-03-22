# Issue #845: WebUI panel layout model: add typed panel registry and default layout state

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/845
- Branch: codex/issue-845
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7bcc7b650d92f3e14192376cd2cadbe413b56fc6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T20:00:41.826Z

## Latest Codex Summary
- Added a typed WebUI dashboard panel registry plus a local layout-state model, switched the dashboard shell to render panel sections from that registry, and locked the current default panel order in focused tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: a small WebUI-only panel layout module can define stable panel identifiers, preserve the current dashboard arrangement as default state, and provide a safe fallback path for future browser-managed ordering or visibility without affecting supervisor or CLI behavior.
- What changed: added `src/backend/webui-dashboard-panel-layout.ts` with typed panel ids, registry entries, default layout state, and layout normalization; updated `src/backend/webui-dashboard-page.ts` to render overview/details sections from that registry instead of hard-coded panel markup order; added focused tests for registry/layout fallback and for the rendered default panel sequence.
- Current blocker: none
- Next exact step: review the diff for cleanup, then commit this checkpoint and open/update a draft PR if the branch does not already have one.
- Verification gap: none on the focused scope; the issue verification command passed after the layout refactor.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-panel-layout.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the change is isolated to dashboard shell rendering and typed browser-side layout metadata, with no supervisor API or CLI behavior changes.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
- Last focused failure: none.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-845/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-845/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "panel|dashboard|layout|registry" src/backend
sed -n '1,260p' src/backend/webui-dashboard.test.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.test.ts
rg --files src/backend | rg 'webui-dashboard|webui-.*dashboard|dashboard-browser|dashboard-page'
sed -n '388,580p' src/backend/webui-dashboard-page.ts
sed -n '1,220p' src/backend/webui-dashboard-browser-script.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.ts
rg -n "renderSupervisorDashboardHtml|Operator dashboard|Tracked history|Issue details|Operator actions|Live events|Status|Doctor" src/backend/webui-dashboard.test.ts
sed -n '260,420p' src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
git status --short
git diff -- src/backend/webui-dashboard-panel-layout.ts src/backend/webui-dashboard-page.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts .codex-supervisor/issue-journal.md
```
### Scratchpad
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
