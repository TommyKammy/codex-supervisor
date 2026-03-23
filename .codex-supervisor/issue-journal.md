# Issue #863: Stale recovery convergence: stop repeated no-progress stale cleanup at manual review earlier

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/863
- Branch: codex/issue-863
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 93fbe8647b116495fe63437324a8d844c494b60f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T02:35:27.011Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale stabilizing no-PR recovery was preserving its repeat count in direct helper coverage but dropping it in the full run loop because the lifecycle reset compared against the current `queued` state instead of the inferred next `stabilizing` state.
- What changed: updated no-PR stale recovery preservation so queued stale requeues keep `stale_stabilizing_no_pr_recovery_count` and related stale-loop tracking when the next lifecycle state is `stabilizing`; added focused helper/lifecycle coverage for the queued-to-stabilizing case and tightened the orchestration replay to prove the next stale cleanup converges to `manual_review`.
- Current blocker: none
- Next exact step: review the diff, commit the stale recovery convergence fix, and decide whether to open a draft PR if one is still absent for `codex/issue-863`.
- Verification gap: focused stale recovery and supervisor verification are green locally; broader repository test suites remain unrun this turn.
- Files touched: `src/no-pull-request-state.ts`, `src/no-pull-request-state.test.ts`, `src/run-once-turn-execution.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-lifecycle.ts`, `src/supervisor/supervisor-lifecycle.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`
- Rollback concern: medium-low; the behavior change is intentionally narrow to queued stale no-PR requeues, but it touches the generic no-PR lifecycle reset path and should stay covered by the focused orchestration replay.
- Last focused command: `npx tsx --test src/no-pull-request-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: `stale-no-pr-recovery-count-reset-after-queued-requeue`
- Last focused commands:
```bash
sed -n '1,220p' "<local-memory>/issue-863/AGENTS.generated.md"
sed -n '1,220p' "<local-memory>/issue-863/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
rg -n "stale_stabilizing_no_pr_recovery_count|shouldPreserveStaleStabilizingNoPrRecoveryTracking|resetNoPrLifecycleFailureTracking|manual_review" src
npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts
npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts
apply_patch
npx tsx --test src/no-pull-request-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts
rm .codex-supervisor/replay/decision-cycle-snapshot.json && rmdir .codex-supervisor/replay
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T02:44:29Z: reproduced the stale convergence bug with `src/supervisor/supervisor-execution-orchestration.test.ts`; the stale cleanup requeued the issue but the next cycle reset `stale_stabilizing_no_pr_recovery_count` to `0` before the successful no-PR turn finished.
- 2026-03-23T02:44:29Z: fixed the queued-to-stabilizing preservation gap by passing the inferred next no-PR state into `resetNoPrLifecycleFailureTracking`, widened stale preservation to queued stale requeues, and passed `npx tsx --test src/no-pull-request-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts`.
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
