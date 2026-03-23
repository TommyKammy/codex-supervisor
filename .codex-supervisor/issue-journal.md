# Issue #874: Operator observability CLI: surface concise retry and recovery-loop summaries in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/874
- Branch: codex/issue-874
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a0f020e72cb903f880c34cb5cc4c112d5844ae00
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T10:06:13.790Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: concise CLI anomaly lines should be derived from the typed operator activity DTO so `status` and `explain` can highlight retry pressure and recovery-loop risk without adding separate loop-tracking logic in the CLI layer.
- What changed: added shared `retry_summary` and `recovery_loop_summary` formatters in `src/supervisor/supervisor-operator-activity-context.ts`, threaded `activityContext` into status summary rendering, rendered the same summaries in explain output, and added focused coverage in `src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `src/supervisor/supervisor-selection-issue-explain.test.ts`.
- Current blocker: none
- Next exact step: stage the focused CLI observability patch, commit it on `codex/issue-874`, and then open or update the draft PR with this checkpoint.
- Verification gap: none on the scoped CLI path; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts` passes on the local diff.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-operator-activity-context.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: low; the change only adds compact CLI summary lines derived from existing typed observability data plus focused render-path tests.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts`
- Last focused failure: before the patch, the CLI rendered raw retry counters and the stale no-PR warning, but it did not surface compact retry/recovery-loop summaries from the typed activity context; the focused verification command now passes.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-874/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-874/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "retry|recovery loop|recovery reason|no-progress|observability|status selection|issue explain|operator activity" src/supervisor src -g '!node_modules'
sed -n '1,260p' src/supervisor/supervisor-diagnostics-status-selection.test.ts
sed -n '1,260p' src/supervisor/supervisor-selection-issue-explain.test.ts
sed -n '1,220p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1,260p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1,260p' src/supervisor/supervisor-detailed-status-assembly.ts
sed -n '1,260p' src/supervisor/supervisor-status-rendering.ts
sed -n '1,220p' src/supervisor/supervisor-selection-active-status.ts
sed -n '1,240p' src/supervisor/supervisor-status-model.ts
sed -n '400,540p' src/backend/webui-dashboard-browser-script.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts
apply_patch
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
git diff -- src/supervisor/supervisor-operator-activity-context.ts src/supervisor/supervisor-status-model.ts src/supervisor/supervisor-selection-issue-explain.ts src/supervisor/supervisor.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts
```
### Scratchpad
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
