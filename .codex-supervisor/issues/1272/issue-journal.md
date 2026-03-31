# Issue #1272: [codex] Warn when localCiCommand is configured without workspacePreparationCommand

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1272
- Branch: codex/issue-1272
- Workspace: .
- Journal: .codex-supervisor/issues/1272/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f42d5a5bd0f486e28fdd51d525602ea9b130f67e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T22:51:03.398Z

## Latest Codex Summary
- Added a shared advisory when `localCiCommand` is configured without `workspacePreparationCommand`, surfaced through setup readiness, doctor output, and tracked-PR blocker diagnostics without changing blocking semantics.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Preserved worktrees can miss host toolchains even when GitHub checks are green, so operators need an explicit warning whenever host-local CI is configured without a repo-owned workspace preparation contract.
- What changed: Added a shared missing-workspace-preparation advisory in config summaries, rendered it in doctor warnings and setup local-CI details, and expanded tracked-PR mismatch diagnostics with an explicit likely-cause message. Tightened focused tests across doctor, setup/dashboard, status selection, config update, and browser helpers.
- Current blocker: `npm run build` cannot complete in this workspace because the build script expects `tsc` on PATH, but TypeScript is not installed locally here.
- Next exact step: Commit the warning + test changes on `codex/issue-1272`; if build verification is required in this environment, install project TypeScript dependencies first and rerun `npm run build`.
- Verification gap: `npm run build` remains environment-blocked (`sh: 1: tsc: not found`). Targeted and broader TS test suites passed.
- Files touched: src/core/config.ts; src/core/types.ts; src/setup-readiness.ts; src/doctor.ts; src/supervisor/tracked-pr-mismatch.ts; related tests under src/doctor.test.ts, src/backend/webui-dashboard.test.ts, src/backend/webui-browser-script-helpers.test.ts, src/config.test.ts, src/supervisor/supervisor-diagnostics-status-selection.test.ts, src/supervisor/supervisor-service.test.ts.
- Rollback concern: Low; changes are advisory-only and confined to typed summaries/rendering, but reverting should keep the new tests aligned because they now enforce the explicit warning contract.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
