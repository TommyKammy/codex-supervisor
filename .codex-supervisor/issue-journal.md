# Issue #1619: Narrow loop-off tracked-work blockers to loop-advanceable states

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1619
- Branch: codex/issue-1619
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 78f53be1b6b3be1d5bc0482c6c6b1d5d6419e530
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-21T14:15:56.778Z

## Latest Codex Summary
- Narrowed the loop-off tracked-work blocker to loop-advanceable states only, then added focused regressions for blocked-only and mixed tracked-work sets across status, explain, and WebUI surfaces.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The loop-off blocker was too broad because it treated every non-`done` tracked issue as restartable background work; `blocked` and `failed` tracked records should stay visible but should not trigger the restart-the-loop message.
- What changed: Added `isLoopAdvanceableState()` in `src/core/utils.ts`, switched `buildLoopOffTrackedWorkBlocker()` to use it, and tightened WebUI tracked-work filtering so blocked-only/failed-only tracked sets no longer produce loop-restart messaging while mixed sets still point at the first loop-advanceable issue. Added focused regressions in status, explain, dashboard browser logic, and dashboard rendering tests.
- Current blocker: none
- Next exact step: commit this checkpoint on `codex/issue-1619` and proceed with PR/update flow if requested by the supervisor.
- Verification gap: none for the requested local bundle; targeted regressions and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/core/utils.ts`; `src/supervisor/supervisor-loop-runtime-state.ts`; `src/backend/webui-dashboard-browser-logic.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `src/supervisor/supervisor-diagnostics-explain.test.ts`; `src/backend/webui-dashboard-browser-logic.test.ts`; `src/backend/webui-dashboard.test.ts`
- Rollback concern: If loop-off guidance is later meant to include a specific blocked subtype, the shared loop-advanceable predicate is now the enforcement point for both CLI/reporting and WebUI surfaces.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
