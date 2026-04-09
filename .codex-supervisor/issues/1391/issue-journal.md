# Issue #1391: Refactor: extract dashboard page rendering and layout helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1391
- Branch: codex/issue-1391
- Workspace: .
- Journal: .codex-supervisor/issues/1391/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: cf953b61fa2029daeb52aff404b373f8fc9328f3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T08:10:34.898Z

## Latest Codex Summary
- Extracted dashboard page section/context helpers and page layout assembly out of `webui-dashboard-page.ts` into dedicated modules, added focused helper tests, and verified the existing dashboard HTML contract still passes.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The dashboard page file can be reduced to orchestration if section/context rendering and outer HTML layout assembly are split into dedicated helpers without changing the rendered contract.
- What changed: Added `webui-dashboard-page-sections.ts` and `webui-dashboard-page-layout.ts`; refactored `webui-dashboard-page.ts` into a thin wrapper; added focused tests for the extracted helpers in `src/backend/webui-dashboard.test.ts`.
- Current blocker: none
- Next exact step: Commit the refactor checkpoint on `codex/issue-1391` and hand control back in a stabilizing state.
- Verification gap: No browser smoke rerun in this turn; focused dashboard/server tests and `npm run build` passed.
- Files touched: `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard-page-layout.ts`, `src/backend/webui-dashboard-page-sections.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: Low; changes preserve the existing page HTML contract and only move rendering responsibilities.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
