# Issue #862: Stale recovery counter: add dedicated repetition tracking for stale stabilizing no-PR cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/862
- Branch: codex/issue-862
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: be0e4b678496c99ee41766cb87d1d06a1cc72518
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T01:38:16.686Z

## Latest Codex Summary
- Added dedicated stale stabilizing no-PR recovery tracking that survives successful no-PR turns without depending on `repeated_failure_signature_count`, and covered increment/reset/persistence behavior with focused regression tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale stabilizing no-PR recovery was still coupled to the generic failure-signature repeat counter, so successful no-PR turns could leave the stale loop visible in `last_failure_*` while later resets or reuse of `repeated_failure_signature_count` erased the loop budget.
- What changed: added `stale_stabilizing_no_pr_recovery_count` to `IssueRunRecord` normalization/state-store updates, introduced `getStaleStabilizingNoPrRecoveryCount` in `src/no-pull-request-state.ts`, switched stale recovery reconciliation to increment/reset that dedicated counter, and updated the no-PR lifecycle plus successful no-PR turn path to preserve the stale recovery context while resetting the generic failure-signature count.
- Current blocker: none
- Next exact step: commit the dedicated stale recovery counter changes, push `codex/issue-862`, and open a draft PR because the focused local verification is green.
- Verification gap: none in the focused stale no-PR recovery surface; helper, lifecycle, turn execution, and reconciliation coverage all pass locally.
- Files touched: `src/core/types.ts`, `src/core/state-store.ts`, `src/no-pull-request-state.ts`, `src/no-pull-request-state.test.ts`, `src/run-once-turn-execution.ts`, `src/run-once-turn-execution.test.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-lifecycle.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the new counter is narrowly scoped to stale stabilizing no-PR recovery and falls back to the previous generic repeat count only for migration/older state compatibility.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/no-pull-request-state.test.ts`
- Last focused failure: `stale-no-pr-recovery-counter-shared-generic-reset`
- Last focused commands:
```bash
sed -n '1,220p' "<local-memory>/issue-862/AGENTS.generated.md"
sed -n '1,220p' "<local-memory>/issue-862/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
rg -n "stale.*no-PR|stale.*no-pr|no-pr.*stale|stale_state_cleanup|repeated_failure_signature_count|last_failure_context|recovery.*counter|repetition" src -g '!**/dist/**'
sed -n '1,260p' src/supervisor/supervisor-recovery-reconciliation.test.ts
sed -n '1,260p' src/run-once-turn-execution.test.ts
sed -n '1,260p' src/supervisor/supervisor-lifecycle.test.ts
sed -n '1080,1225p' src/recovery-reconciliation.ts
sed -n '1,260p' src/no-pull-request-state.ts
sed -n '400,490p' src/run-once-turn-execution.ts
sed -n '180,240p' src/supervisor/supervisor-lifecycle.ts
sed -n '40,90p' src/supervisor/supervisor-failure-helpers.ts
sed -n '1,240p' src/core/state-store.ts
sed -n '520,760p' src/supervisor/supervisor-recovery-reconciliation.test.ts
sed -n '840,1045p' src/run-once-turn-execution.test.ts
sed -n '1,240p' src/no-pull-request-state.test.ts
npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts
npx tsx --test src/no-pull-request-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts
npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts
npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/no-pull-request-state.test.ts
gh pr list --head codex/issue-862 --json number,isDraft,url,state
git diff -- src/core/types.ts src/core/state-store.ts src/no-pull-request-state.ts src/no-pull-request-state.test.ts src/run-once-turn-execution.ts src/run-once-turn-execution.test.ts src/recovery-reconciliation.ts src/supervisor/supervisor-lifecycle.ts src/supervisor/supervisor-recovery-reconciliation.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T01:42:48Z: reproduced the stale no-PR counter coupling with focused failing assertions in `src/run-once-turn-execution.test.ts` and `src/supervisor/supervisor-recovery-reconciliation.test.ts`, then switched stale recovery to a dedicated `stale_stabilizing_no_pr_recovery_count` that survives successful no-PR turns while generic failure-signature counts reset independently; focused no-PR helper, lifecycle, turn, and reconciliation tests now pass.
- 2026-03-22T22:09:23Z: reproduced the drag-reorder gap with a pure browser-logic regression, then added draggable panel handles, browser-only DOM reorder state, and a runtime dashboard drag test; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
