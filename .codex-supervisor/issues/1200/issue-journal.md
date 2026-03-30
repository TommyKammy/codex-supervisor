# Issue #1200: Setup opt-in flow: let operators save recommended localCiCommand from WebUI

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1200
- Branch: codex/issue-1200
- Workspace: .
- Journal: .codex-supervisor/issues/1200/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7960db28bafad639185f50b058e0a5c0c6026e6c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T09:56:36.816Z

## Latest Codex Summary
- Setup readiness now exposes `localCiCommand` as an optional editable setup field, setup config writes accept and persist it, and the setup WebUI offers an explicit "Use recommended command" opt-in action that fills the field and revalidates readiness after save.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The issue was blocked by three disconnected seams: `diagnoseSetupReadiness` did not include `localCiCommand` in editable setup fields, `updateSetupConfig` rejected `localCiCommand` as outside the setup-owned write surface, and the setup shell only displayed the recommendation without a direct opt-in control.
- What changed: Added `localCiCommand` to setup readiness and setup-config write contracts, treated it as optional/non-blocking for first-run readiness, rendered it in the setup form, added a dedicated "Use recommended command" button in the local CI panel, and added focused tests covering readiness exposure, persistence, and adopt-and-save revalidation.
- Current blocker: None for the issue implementation. Extra local verification outside the issue scope still reports unrelated pre-existing `src/config.test.ts` CodeRabbit starter-profile failures, and `npm run build` fails in this workspace because `tsc` is not installed.
- Next exact step: Commit the checkpoint on `codex/issue-1200`; if a broader green run is required later, fix or defer the unrelated CodeRabbit config failures and ensure TypeScript is installed before rerunning `npm run build`.
- Verification gap: `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` passed; a broader `src/config.test.ts` sweep still fails on unrelated CodeRabbit expectations; `npm run build` is blocked by missing `tsc`.
- Files touched: `.codex-supervisor/issues/1200/issue-journal.md`, `src/setup-readiness.ts`, `src/setup-config-write.ts`, `src/backend/webui-setup-page.ts`, `src/backend/webui-setup-browser-script.ts`, `src/doctor.test.ts`, `src/config.test.ts`, `src/backend/webui-dashboard.test.ts`.
- Rollback concern: Low. Main behavior change is limited to setup-owned config fields and optional setup UI affordances; clearing `localCiCommand` is still not supported through the form because empty-string writes remain rejected by the narrow setup API.
- Last focused command: `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
