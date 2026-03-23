# Issue #873: Operator observability contract: add typed retry, recovery, and phase-change context

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/873
- Branch: codex/issue-873
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 280f63565c1c792156440bff42db8c38228d3b9b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T08:04:57.930Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the existing operator activity context is the right DTO boundary; extending it with typed retry counts, repeated stale-recovery metadata, and recovery-derived phase transitions should satisfy status and explain without changing legacy status lines.
- What changed: added typed retry, repeated-recovery, and recent phase-change fields to `SupervisorIssueActivityContextDto` in `src/supervisor/supervisor-operator-activity-context.ts`, then tightened the focused service/status/explain tests to assert the new contract.
- Current blocker: none
- Next exact step: commit this observability checkpoint on `codex/issue-873`, then decide whether to open the draft PR immediately or continue with any follow-up UI wiring in a later pass.
- Verification gap: none for the targeted supervisor DTO surfaces; the requested focused suites are passing locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-operator-activity-context.ts`, `src/supervisor/supervisor-service.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`
- Rollback concern: low; the change is additive DTO expansion around existing record fields and recovery parsing, with legacy status lines left intact.
- Last focused command: `npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts`
- Last focused failure: missing typed `retryContext`, `repeatedRecovery`, and `recentPhaseChanges` fields on the shared operator activity context.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
sed -n '1,260p' src/supervisor/supervisor-service.test.ts
sed -n '1,260p' src/supervisor/supervisor-diagnostics-status-selection.test.ts
sed -n '1,260p' src/supervisor/supervisor-selection-issue-explain.test.ts
sed -n '1,360p' src/supervisor/supervisor-operator-activity-context.ts
apply_patch
npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts
git status --short --branch
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T08:10:30Z: reproduced the missing typed observability contract by tightening the focused service/status/explain tests, then passed the requested verification after extending the shared activity-context DTO with retry counts, repeated stale no-PR recovery metadata, and recovery-derived recent phase changes.
- 2026-03-23T07:22:48Z: validated the CodeRabbit flake note, added a DOM-order `waitForFunction` after the first pointer drag in `src/backend/webui-dashboard-browser-smoke.test.ts`, and re-passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
