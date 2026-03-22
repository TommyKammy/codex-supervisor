# Issue #846: WebUI panel shell: standardize dashboard blocks before drag-and-drop

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/846
- Branch: codex/issue-846
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: c4e2a04cb243153b2e6437fa139ed5f253863dc4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T21:14:15Z

## Latest Codex Summary
- Standardized the dashboard panels around a shared shell helper, preserving existing browser-script ids and command semantics while adding a reserved drag-slot lane, panel subtitles, and shared empty-state treatment.
- Added a focused dashboard regression that proves each registered panel uses the common shell structure.
- Committed the implementation as `c4e2a04` (`feat: standardize dashboard panel shell`).

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining issue-846 gap is structural rather than behavioral, so a shared panel shell helper can standardize dashboard headers, subtitles, body framing, reserved drag-handle space, and initial empty states while keeping all existing DOM ids and backend/browser command semantics intact.
- What changed: added a focused failing regression in `src/backend/webui-dashboard.test.ts` that proved each panel lacked a common shell; replaced duplicated panel HTML in `src/backend/webui-dashboard-panel-layout.ts` with a `renderDashboardPanelShell(...)` helper; added shared subtitle, header-meta/action lanes, and a reserved `panel-drag-slot`; updated `src/backend/webui-dashboard-page.ts` styles for the new shell and common empty-state treatment.
- Current blocker: none
- Next exact step: push `codex/issue-846` and open a draft PR for issue #846 from this worktree, then monitor CI/review feedback.
- Verification gap: none on the focused issue scope; the requested dashboard test command passed after the shell refactor.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-panel-layout.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the change is isolated to WebUI dashboard markup/CSS and preserves existing browser-script ids plus command endpoints.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`
- Last focused failure: `dashboard-panel-shell-structure-missing`.
- Last focused commands:
```bash
gh pr status
date -u +%Y-%m-%dT%H:%M:%SZ
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-846/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-846/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg --files src/backend | rg 'webui-dashboard|dashboard'
rg -n "panel shell|panel-shell|drag handle|empty state|dashboard panel|data-panel|panel-header|dashboard-block|panel-subtitle" src/backend
sed -n '1,260p' src/backend/webui-dashboard-panel-layout.ts
sed -n '1,260p' src/backend/webui-dashboard.test.ts
sed -n '1,260p' src/backend/webui-dashboard-page.ts
sed -n '260,520p' src/backend/webui-dashboard-panel-layout.ts
sed -n '260,520p' src/backend/webui-dashboard-page.ts
sed -n '260,520p' src/backend/webui-dashboard.test.ts
rg -n "status-warning|doctor-overall|issue-summary|tracked-history-toggle|command-status|event-list|operator-timeline|tracked-history-summary|tracked-history-lines|issue-shortcuts|issue-form|issue-explain|issue-lint|run-once-button|requeue-button|prune-workspaces-button|reset-json-state-button" src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard-browser-logic.ts
sed -n '1,320p' src/backend/webui-dashboard-browser-script.ts
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
git status --short
git diff -- src/backend/webui-dashboard-panel-layout.ts src/backend/webui-dashboard-page.ts src/backend/webui-dashboard.test.ts
```
### Scratchpad
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
