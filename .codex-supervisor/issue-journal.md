# Issue #864: Stale recovery visibility: surface repeated stale cleanup risk in status and replay

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/864
- Branch: codex/issue-864
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3129e0ab05f786882af696ebaff3bd07164d559e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T03:07:44.065Z

## Latest Codex Summary
- Surfaced repeated stale no-PR recovery risk in status and explain output, persisted the dedicated stale recovery count in replay snapshots, and opened draft PR #869 after focused verification passed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #864's remaining gap was operator visibility rather than stale-loop accounting itself; the stale no-PR recovery count already survived the queue-to-stabilizing lifecycle, but status/explain omitted a focused warning and replay snapshots dropped the dedicated stale recovery counter.
- What changed: added `stale_recovery_warning` rendering for repeated stale stabilizing no-PR loops in status and explain, and extended cycle replay snapshots to persist `stale_stabilizing_no_pr_recovery_count`; added focused regressions for all three operator-facing surfaces.
- Current blocker: none
- Next exact step: review the final diff, commit the stale recovery visibility checkpoint on `codex/issue-864`, and check whether a draft PR should be opened for the branch.
- Verification gap: the issue-targeted status/explain/replay verification is green locally; broader repository test suites remain unrun this turn.
- Files touched: `src/no-pull-request-state.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-cycle-snapshot.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-cycle-snapshot.test.ts`
- Rollback concern: low; the code change is presentation-focused plus one replay snapshot field, but the new stale warning is emitted for all matching repeated stale no-PR recovery records and should stay covered by the focused tests.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts`
- Last focused failure: none
- Last focused commands:
```bash
sed -n '1,220p' "<local-memory>/issue-864/AGENTS.generated.md"
sed -n '1,220p' "<local-memory>/issue-864/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "stale|recovery|repeat|warning|status|replay|cycle snapshot|snapshot" src/supervisor src
sed -n '1,240p' src/supervisor/supervisor-diagnostics-status-selection.test.ts
sed -n '1,260p' src/supervisor/supervisor-selection-issue-explain.test.ts
sed -n '1,260p' src/supervisor/supervisor-cycle-snapshot.test.ts
sed -n '1,260p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1,260p' src/supervisor/supervisor-cycle-snapshot.ts
sed -n '1,320p' src/supervisor/supervisor.ts
sed -n '1,320p' src/supervisor/supervisor-status-model.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts
sed -n '1,340p' src/supervisor/supervisor-detailed-status-assembly.ts
sed -n '1,260p' src/core/types.ts
rg -n "stale_stabilizing_no_pr_recovery_count|stale-stabilizing-no-pr-recovery-loop|repeat_count" src
sed -n '260,420p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1100,1195p' src/recovery-reconciliation.ts
sed -n '1,220p' src/no-pull-request-state.ts
sed -n '1,280p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1,260p' src/supervisor/supervisor-status-report.ts
sed -n '1,220p' src/supervisor/supervisor-selection-active-status.ts
apply_patch
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts
git status --short
git diff --stat
date -u +%Y-%m-%dT%H:%M:%SZ
gh pr view --json number,isDraft,state,url --head codex/issue-864
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T03:10:29Z: committed the stale recovery visibility slice as `15f07e6` (`Surface repeated stale recovery risk`), pushed `codex/issue-864`, and opened draft PR `#869` at https://github.com/TommyKammy/codex-supervisor/pull/869.
- 2026-03-23T03:10:29Z: reproduced the remaining issue-864 gap as missing operator visibility instead of missing stale-loop state, then added `stale_recovery_warning` coverage to status/explain plus replay snapshot persistence for `stale_stabilizing_no_pr_recovery_count`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts` passed.
- 2026-03-23T02:12:08Z: committed the journal markdown cleanup as `b45d12b`, pushed `codex/issue-862`, and resolved GitHub review thread `PRRT_kwDORgvdZ852BDOu`.
- 2026-03-23T02:11:10Z: rewrote the unresolved `.codex-supervisor/issue-journal.md` review blob into multi-line Markdown, then confirmed `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg -n "MD038|no-space-in-code"` returned no matches even though full-file markdownlint still reports pre-existing non-MD038 journal warnings.
- 2026-03-23T01:57:27Z: pushed review-fix commit `4c2e232` to `codex/issue-862` and resolved GitHub review thread `PRRT_kwDORgvdZ852A-pm` with `gh api graphql`.
- 2026-03-23T01:55:57Z: validated CodeRabbit thread `PRRT_kwDORgvdZ852A-pm` against the live branch, confirmed `getStaleStabilizingNoPrRecoveryCount` leaked `stale_stabilizing_no_pr_recovery_count` across unrelated failure signatures, then scoped the helper to the stale signature and passed `npx tsx --test src/no-pull-request-state.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
