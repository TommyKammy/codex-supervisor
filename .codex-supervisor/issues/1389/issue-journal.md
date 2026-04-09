# Issue #1389: Refactor: extract dashboard view-model formatting and browser snapshot helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1389
- Branch: codex/issue-1389
- Workspace: .
- Journal: .codex-supervisor/issues/1389/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e44e80f88d38396a2ee834032fa0ca88e93bee6f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T06:57:16.580Z

## Latest Codex Summary
- Extracted pure dashboard browser view-model helpers from the inline script into `src/backend/webui-dashboard-browser-view-model.ts`, added focused unit coverage for the new seam, and verified dashboard/server behavior stays stable under the issue's targeted test command plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The refactor can proceed safely by extracting pure presentation/state-derivation helpers first, as long as injected browser helpers remain runtime-self-contained for `Function#toString()` injection.
- What changed: Added `webui-dashboard-browser-view-model.ts` with extracted pure helpers (`buildWorkflowSteps`, `describeLoopRuntime`, `formatRefreshTime`, `countCandidateIssues`, `metricClass`, `formatKeyValueBlock`, `liveBadgeClass`), updated `webui-dashboard-browser-script.ts` to import/inject them, and added focused unit coverage in `webui-dashboard-browser-view-model.test.ts`.
- Current blocker: none
- Next exact step: Commit the extraction checkpoint on `codex/issue-1389`; if continuing, consider whether additional non-DOM snapshot helpers should move out of the browser script in a second slice.
- Verification gap: None for the extracted helper slice; targeted dashboard/server verification and full build both passed locally.
- Files touched: `.codex-supervisor/issues/1389/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-browser-view-model.ts`, `src/backend/webui-dashboard-browser-view-model.test.ts`
- Rollback concern: The injected browser helpers must stay free of runtime import-wrapper references; an earlier attempt failed until the extracted module became self-contained.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`
### Scratchpad
- Reproduced focused failure first with `npx tsx --test src/backend/webui-dashboard-browser-view-model.test.ts` (`MODULE_NOT_FOUND` for the new extraction seam), then implemented the module and reran targeted tests.
