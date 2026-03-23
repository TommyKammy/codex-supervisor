# Issue #871: WebUI drag-and-drop bug: fix asymmetric pointer reordering across dashboard columns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/871
- Branch: codex/issue-871
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 62e8d495a6efdee617117dbf18ce6e229a91d6e3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T06:56:21.776Z

## Latest Codex Summary
- Added a real-browser smoke regression for dashboard pointer reordering in both horizontal directions, then fixed the WebUI drag handling by tracking pointer-hover targets with `elementFromPoint()` and ignoring bubbled descendant `dragleave` churn.
- Verified that pointer reordering, keyboard reordering, and the existing dashboard/browser suites all pass locally along with `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the asymmetric pointer reorder bug came from relying on native `dragover`/`dragleave` target state alone; a local pointer-tracking path plus descendant-safe `dragleave` handling fixes the dashboard reorder behavior without touching backend semantics.
- What changed: added `browser smoke reorders the dashboard with pointer dragging in both horizontal directions` in `src/backend/webui-dashboard-browser-smoke.test.ts`, then updated `src/backend/webui-dashboard-browser-script.ts` so pointer drags track hover targets with `document.elementFromPoint()`, commit on `pointerup`, suppress conflicting native drags for that path, and ignore bubbled child `dragleave` events.
- Current blocker: none
- Next exact step: stage the dashboard/browser files plus this journal update, commit the verified checkpoint, and then decide whether to push/open the draft PR for `codex/issue-871`.
- Verification gap: none on the local fix; the focused browser/UI tests and full build passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-browser-smoke.test.ts`
- Rollback concern: moderate-low; the change is local to WebUI drag behavior, but pointer handling now has a custom path that should stay aligned with the existing keyboard/native drag semantics.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`
- Last focused failure: `pointer-drag-cancelled-before-target` during early smoke-test reproduction; resolved after scrolling targets into view in the browser test and adding the custom pointer drag path in the dashboard script.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-871/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-871/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "drag|pointer|reorder|dashboard" src/backend -g '*test.ts'
sed -n '1,220p' src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-script.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.ts
sed -n '260,520p' src/backend/webui-dashboard-browser-script.ts
sed -n '520,920p' src/backend/webui-dashboard.test.ts
sed -n '1,220p' src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '960,1095p' src/backend/webui-dashboard-browser-script.ts
npm ci
npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts
apply_patch
apply_patch
npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts --test-name-pattern "pointer dragging"
sed -n '1,260p' src/backend/webui-dashboard-page.ts
sed -n '260,340p' src/backend/webui-dashboard-page.ts
rg -n "asymmetric|right to left|left to right|drag-and-drop|pointer reordering|dragleave" -S .
apply_patch
npx tsx --test src/backend/webui-dashboard.test.ts
apply_patch
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts
npm run build
git status --short --branch
git diff -- src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard-browser-smoke.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T07:08:26Z: reproduced the missing real-browser pointer coverage with a new smoke test, then fixed the dashboard by adding a pointer-driven reorder path backed by `elementFromPoint()` and descendant-safe `dragleave` handling; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts` and `npm run build` both passed.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
