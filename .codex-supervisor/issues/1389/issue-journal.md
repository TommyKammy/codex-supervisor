# Issue #1389: Refactor: extract dashboard view-model formatting and browser snapshot helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1389
- Branch: codex/issue-1389
- Workspace: .
- Journal: .codex-supervisor/issues/1389/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 901373615d28f72cda2075bdfa3e79ba9293e1cb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T07:05:35.985Z

## Latest Codex Summary
Extracted the pure dashboard browser view-model helpers into [`src/backend/webui-dashboard-browser-view-model.ts`](src/backend/webui-dashboard-browser-view-model.ts) and updated [`src/backend/webui-dashboard-browser-script.ts`](src/backend/webui-dashboard-browser-script.ts) to inject those helpers instead of owning them inline. I added focused unit coverage in [`src/backend/webui-dashboard-browser-view-model.test.ts`](src/backend/webui-dashboard-browser-view-model.test.ts), reproduced the seam first via a missing-module failure, then fixed the extraction so the injected browser helpers stay runtime-self-contained.

Checkpoint commit: `9013736` (`Extract dashboard browser view-model helpers`)

Summary: Extracted dashboard browser view-model helpers into a dedicated module, added focused tests, and passed targeted dashboard/server verification plus build.
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-view-model.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-view-model.test.ts --test-name-pattern 'buildWorkflowSteps|describeLoopRuntime|countCandidateIssues|dashboard derives the selected issue from typed status fields without parsing why lines|dashboard keeps Summary focused on current state and only shows tracked issue count|dashboard status panel surfaces advisory local CI posture without reopening setup|dashboard does not claim loop mode is off while typed runtime status reports the loop is running|dashboard renders the loop-off presentation only when typed runtime status reports loop off'`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`; `npm run build`
Next action: Continue the refactor by extracting the next non-DOM browser snapshot/helper slice from `webui-dashboard-browser-script.ts` into a dedicated helper module.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining pure issue-detail snapshot formatting can move out of `webui-dashboard-browser-script.ts` as long as extracted browser helpers stay self-contained and accept any imported browser-runtime formatters as explicit arguments.
- What changed: Added `webui-dashboard-browser-view-model.ts` with extracted pure helpers (`buildWorkflowSteps`, `describeLoopRuntime`, `formatRefreshTime`, `countCandidateIssues`, `metricClass`, `formatKeyValueBlock`, `liveBadgeClass`), then added `webui-dashboard-browser-issue-details.ts` with extracted typed issue-detail section builders (`formatLatestRecovery`, `formatReviewWaits`, `buildIssueExplainSections`) and updated `webui-dashboard-browser-script.ts` to inject and call them without owning the formatting logic inline. Added focused unit coverage in `webui-dashboard-browser-view-model.test.ts` and `webui-dashboard-browser-issue-details.test.ts`.
- Current blocker: none
- Next exact step: Commit the extraction checkpoint on `codex/issue-1389`, then open or update a draft PR for reviewable checkpointing.
- Verification gap: None for the extracted helper slices; focused helper tests, targeted dashboard/server verification, and full build passed locally after fixing injection regressions.
- Files touched: `.codex-supervisor/issues/1389/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-browser-view-model.ts`, `src/backend/webui-dashboard-browser-view-model.test.ts`, `src/backend/webui-dashboard-browser-issue-details.ts`, `src/backend/webui-dashboard-browser-issue-details.test.ts`
- Rollback concern: Browser helpers serialized via `Function#toString()` cannot capture module-local or imported wrapper bindings; an initial attempt failed with `buildDetailItems is not defined`, then with `import_webui_dashboard_browser_logic is not defined`, until the helper accepted imported formatters as explicit runtime arguments.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`
### Scratchpad
- Reproduced focused failure first with `npx tsx --test src/backend/webui-dashboard-browser-view-model.test.ts` (`MODULE_NOT_FOUND` for the new extraction seam), then implemented the module and reran targeted tests.
- Reproduced two runtime injection failures while extracting issue-detail helpers: first `buildDetailItems is not defined`, then `import_webui_dashboard_browser_logic is not defined`; fixed both by keeping helper internals self-contained and passing imported retry/recovery formatters explicitly at call time.
