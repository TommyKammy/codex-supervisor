# Issue #1053: Restyle the setup shell to match the dashboard-grade admin layout

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1053
- Branch: codex/issue-1053
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 45773f144b3302ac37d287ba1845a6af491ae7dd
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T06:44:57.215Z

## Latest Codex Summary
- Added a focused setup-shell structure regression test that reproduces the missing dashboard-grade frame on `/setup`.
- Restyled `src/backend/webui-setup-page.ts` to reuse the dashboard admin shell language with a masthead, sticky sidebar, shared card treatment, stable progress/guided-config/diagnostics sections, and a dashboard-style footer while keeping the existing setup ids and save/readiness behavior.
- Focused setup WebUI tests, the dedicated setup HTTP route test, and `npm run build` now pass locally.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the `/setup` shell feels like a separate low-fidelity page because it uses a bespoke stacked layout instead of the dashboard's admin frame vocabulary, so reusing the dashboard shell structure should improve hierarchy without changing the typed setup flow.
- What changed: added a focused structure assertion in `src/backend/webui-dashboard.test.ts`; rebuilt `src/backend/webui-setup-page.ts` around a dashboard-grade masthead/sidebar/content/footer shell and reorganized setup content into progress, guided config, and diagnostics sections while preserving the existing `setup-*` ids and browser-script contract.
- Current blocker: none locally.
- Next exact step: review the final diff, commit the setup-shell restyle checkpoint on `codex/issue-1053`, and open or update a draft PR if one is still missing.
- Verification gap: none in the requested local scope after focused setup WebUI verification and a successful local build.
- Files touched: `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup-page.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is presentational and structural, but future edits should preserve the existing `setup-*` ids because the setup browser script still binds directly to them.
- Last focused command: `npm run build`
- Exact failure reproduced: `renderSupervisorSetupHtml()` rendered a standalone `.shell`/`.hero` page without the dashboard-style `page-shell`, `masthead`, `app-layout`, `side-nav`, or stable setup section anchors, so `/setup` looked and read like a separate lower-fidelity surface.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1053/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1053/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg --files | rg 'setup|dashboard|webui|ui|app'`; `rg -n "setup" src .`; `rg -n "dashboard" src .`; `sed -n '1,260p' src/backend/webui-setup-page.ts`; `sed -n '1660,1825p' src/backend/webui-dashboard.test.ts`; `sed -n '1,220p' src/backend/webui-dashboard-page.ts`; `sed -n '260,520p' src/backend/webui-setup-page.ts`; `rg -n "renderSupervisorSetup|setup page|setup shell" src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-setup.ts src/backend/webui-setup-page.ts`; `sed -n '430,540p' src/backend/webui-dashboard.test.ts`; `rg -n "setup-" src/backend/webui-setup-browser-script.ts`; `sed -n '1,260p' src/backend/webui-setup-browser-script.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup page reuses the dashboard-grade admin shell with stable setup sections"`; `rg -n "masthead|topbar|dashboard-footer|overview-grid|details-grid|eyebrow" src/backend/webui-dashboard-page.ts`; `sed -n '220,520p' src/backend/webui-dashboard-page.ts`; `sed -n '1120,1285p' src/backend/webui-dashboard-page.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup page reuses the dashboard-grade admin shell with stable setup sections|setup shell loads typed setup readiness without mixing in dashboard status endpoints|setup shell saves through the narrow setup config API and revalidates readiness after the write"`; `npx tsx --test src/backend/supervisor-http-server.test.ts --test-name-pattern "serves a dedicated setup shell and keeps the dashboard on its own route"`; `sed -n '1,220p' package.json`; `ls package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock`; `npm ci`; `npm run build`.
- PR status: none yet.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
