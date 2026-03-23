# Issue #877: Operator observability WebUI: render typed retry, recovery, and phase-change context clearly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/877
- Branch: codex/issue-877
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9d85be7af1227a446bff96e902d0f3173646b504
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T12:29:25.647Z

## Latest Codex Summary
- Surfaced typed retry, repeated-recovery, and phase-change observability in the WebUI issue detail pane, added focused dashboard regressions for the new rendering, verified the full issue dashboard test command after installing the already-declared local npm dependencies, and opened draft PR #898.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining WebUI observability gap was presentation-only; the explain payload already exposed typed `retryContext`, `repeatedRecovery`, and `recentPhaseChanges`, but the dashboard only rendered general operator summaries plus `latestRecovery`.
- What changed: added typed browser-side summary helpers for retry risk, repeated recovery loops, and recent phase changes; rendered those fields in a dedicated `Retry and recovery` issue detail section; and added focused regressions in the dashboard unit tests and browser-logic tests.
- Current blocker: none
- Next exact step: monitor draft PR `#898` checks and respond only if CI reports a regression or review feedback lands.
- Verification gap: none on the requested dashboard test surface; the full issue verification command passed locally after `npm ci` installed the already-declared `playwright-core` dependency.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the change is a presentation-only WebUI enhancement over existing typed fields and does not change backend contracts or CLI behavior.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`
- Last focused failure: the first full verification attempt failed immediately with `MODULE_NOT_FOUND: playwright-core` because this worktree had not run `npm ci` yet even though `playwright-core` was already declared in `package.json`.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-877/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-877/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "retry|recovery|phase change|operatorSummary|recent activity|observability|phaseChange|recoveryLoop|retryRisk|active issue" src/backend -g '*.ts'
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.test.ts
sed -n '1,320p' src/backend/webui-dashboard.test.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-smoke.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '480,620p' src/backend/webui-dashboard-browser-script.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.ts
rg -n "activityContext|retryContext|phaseChange|recentActivity|operatorSummary|latestRecovery|staleRecovery|recovery loop|retry loop|phase" src -g '*.ts'
sed -n '260,520p' src/backend/webui-dashboard-browser-logic.ts
sed -n '200,330p' src/supervisor/supervisor-selection-issue-explain.test.ts
sed -n '330,430p' src/supervisor/supervisor-selection-issue-explain.test.ts
sed -n '1,240p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '240,440p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1080,1275p' src/backend/webui-dashboard.test.ts
sed -n '1,220p' src/backend/webui-dashboard.ts
apply_patch
npm ci
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
test -d node_modules/playwright-core && echo installed || echo missing
rg -n 'playwright-core|playwright' package.json package-lock.json
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts
git diff -- src/backend/webui-dashboard-browser-logic.ts src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
