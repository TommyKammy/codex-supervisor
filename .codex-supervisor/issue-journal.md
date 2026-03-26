# Issue #1056: Surface restart-required state and restart guidance in the setup UI

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1056
- Branch: codex/issue-1056
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 117ecd8b71721da57a57e701f556f5dd92fa74a9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T07:23:30.948Z

## Latest Codex Summary
- Setup UI now surfaces post-save restart state from the typed `/api/setup-config` response. The setup page includes a dedicated post-save status card, distinguishes restart-required saves from already-effective saves, keeps restart controls disabled, and gives explicit manual restart guidance when needed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the typed restart metadata already returned by `/api/setup-config` is sufficient for the setup shell to render a safe post-save operator handoff without adding any process-control behavior.
- What changed: added a post-save restart status card to `src/backend/webui-setup-page.ts`; taught `src/backend/webui-setup-browser-script.ts` to render restart-required vs already-effective outcomes from the typed save response while keeping `Restart now` disabled; tightened `src/backend/webui-dashboard.test.ts` to cover both restart-required and no-restart save flows; and extended `src/backend/webui-dashboard-browser-smoke.test.ts` so live browser coverage exercises both flows.
- Current blocker: none locally.
- Next exact step: stage the setup UI restart-status changes, commit them on `codex/issue-1056`, and then open or update the draft PR if requested by the supervisor flow.
- Verification gap: none in the requested local scope after focused setup-shell tests, focused browser smoke coverage for both flows, and a successful local build.
- Files touched: `src/backend/webui-setup-page.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard-browser-smoke.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is UI-only on top of the typed restart contract, but future work should keep the setup save outcome separate from readiness refreshes so the operator still sees what the most recent save did.
- Last focused command: `timeout 120s npx -p tsx -p playwright-core node --import tsx --test --test-name-pattern '^browser smoke completes the first-run setup flow through the narrow config API$|^browser smoke reports when a setup save is already effective$' src/backend/webui-dashboard-browser-smoke.test.ts`
- Exact failure reproduced: the setup shell consumed `/api/setup-config` but only rendered a generic `Saved N setup fields.` message, so operators could not tell whether saved changes were already effective or required a supervisor restart, nor which fields triggered the restart requirement.
- Commands run: `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1056/AGENTS.generated.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1056/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "restartRequired|restartScope|restartTriggeredByFields|updatedFields|setup-config" src/backend src | sed -n '1,220p'`; `sed -n '360,560p' src/backend/webui-setup-browser-script.ts`; `sed -n '1860,2015p' src/backend/webui-dashboard.test.ts`; `sed -n '440,560p' src/backend/webui-dashboard-browser-smoke.test.ts`; `rg -n "setup-save-status|data-setup|setup-overall-status|setup-blocker-summary|setup-form" src/backend -g '!*.map'`; `sed -n '1,220p' src/backend/webui-setup-browser-script.ts`; `sed -n '220,420p' src/backend/webui-setup-browser-script.ts`; `sed -n '560,720p' src/backend/webui-setup-page.ts`; `sed -n '2015,2095p' src/backend/webui-dashboard.test.ts`; `sed -n '1200,1315p' src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell saves through the narrow setup config API and revalidates readiness after the write|setup shell distinguishes saved changes that are already effective"`; `rg -n "createDeferredResponse|Deferred" src/backend/webui-dashboard.test.ts | sed -n '1,120p'`; `sed -n '1,220p' src/backend/webui-dashboard.test.ts`; `rg -n "setup-save-status|setup-provider-posture|createDashboardHarness\\(" src/backend/webui-dashboard.test.ts | sed -n '1,220p'`; `sed -n '250,380p' src/backend/webui-dashboard.test.ts`; `sed -n '380,520p' src/backend/webui-dashboard.test.ts`; `sed -n '1760,1848p' src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell saves through the narrow setup config API and revalidates readiness after the write|setup shell distinguishes saved changes that are already effective|setup page reuses the dashboard-grade admin shell with stable setup sections"`; `sed -n '1,220p' src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '220,420p' src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '420,620p' src/backend/webui-dashboard-browser-smoke.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts --test-name-pattern "browser smoke completes the first-run setup flow through the narrow config API|browser smoke reports when a setup save is already effective"`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell saves through the narrow setup config API and revalidates readiness after the write|setup shell distinguishes saved changes that are already effective|setup shell loads typed setup readiness without mixing in dashboard status endpoints"`; `npm run build`; `npm ci`; `npm run build`; `which google-chrome || which google-chrome-stable || which chromium || which chromium-browser`; `npx -p tsx -p playwright-core tsx --test src/backend/webui-dashboard-browser-smoke.test.ts --test-name-pattern "browser smoke completes the first-run setup flow through the narrow config API|browser smoke reports when a setup save is already effective"`; `timeout 120s npx -p tsx -p playwright-core node --import tsx --test --test-name-pattern '^browser smoke completes the first-run setup flow through the narrow config API$|^browser smoke reports when a setup save is already effective$' src/backend/webui-dashboard-browser-smoke.test.ts`.
- PR status: none yet for `codex/issue-1054`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
