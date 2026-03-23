# Issue #873: Operator observability contract: add typed retry, recovery, and phase-change context

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/873
- Branch: codex/issue-873
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: d851469a9cead975322a7757f6f2c05e5970534b
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-23T08:35:48.374Z

## Latest Codex Summary
Added typed operator observability on the shared activity-context DTO in [supervisor-operator-activity-context.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/supervisor/supervisor-operator-activity-context.ts). Status and explain now expose structured `retryContext`, `repeatedRecovery`, and recovery-derived `recentPhaseChanges` without disturbing the legacy status lines. I also tightened the focused contract tests in [supervisor-diagnostics-status-selection.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/supervisor/supervisor-diagnostics-status-selection.test.ts), [supervisor-selection-issue-explain.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/supervisor/supervisor-selection-issue-explain.test.ts), and [supervisor-service.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/supervisor/supervisor-service.test.ts).

Checkpoint commit is `d851469` (`Add typed operator observability context`). I pushed `codex/issue-873` and opened draft PR [#880](https://github.com/TommyKammy/codex-supervisor/pull/880). The only remaining workspace artifact is the pre-existing untracked [`.codex-supervisor/replay/`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/.codex-supervisor/replay/) directory.

Summary: Added typed retry, repeated-recovery, and recent phase-change observability to the shared operator activity context; verified it through focused service/status/explain tests; pushed commit `d851469`; opened draft PR `#880`
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts`
Failure signature: none
Next action: Monitor draft PR `#880` and wire any review-driven follow-up without regressing the legacy CLI status output

## Active Failure Context
- Category: checks
- Summary: PR #880 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/880
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23427540544/job/68145650746
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23427540544/job/68145650707

## Codex Working Notes
### Current Handoff
- Hypothesis: the CI failure came from additive DTO fields not being propagated into compile-checked test doubles, plus a service-test stub whose throw-only async methods widened overrides poorly under stricter typing.
- What changed: updated the HTTP explain fixture in `src/backend/supervisor-http-server.test.ts` to include `retryContext`, `repeatedRecovery`, and `recentPhaseChanges`, and tightened `src/supervisor/supervisor-service.test.ts` by typing the stub supervisor methods and pinning the status/explain fixtures to the real return types with an explicit active-issue narrowing assertion.
- Current blocker: none
- Next exact step: commit and push the CI repair checkpoint on `codex/issue-873`, then rerun PR checks or inspect the refreshed GitHub status until `build` turns green.
- Verification gap: none for the repaired CI path; local `npm run build` and the focused supervisor/HTTP suites are passing.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/supervisor/supervisor-service.test.ts`
- Rollback concern: low; the repair only updates compile-time test fixtures and helper typing to match the already-landed additive DTO contract.
- Last focused command: `npm run build`
- Last focused failure: `src/backend/supervisor-http-server.test.ts` missing `retryContext`/`repeatedRecovery`/`recentPhaseChanges`, plus `src/supervisor/supervisor-service.test.ts` fixture typing widened `state` and collapsed stub overrides into mismatched async signatures.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
gh pr checks 880
gh run view 23427540544 --job 68145650746 --log
node -p "JSON.stringify(require('./package.json').scripts, null, 2)"
npm ci
sed -n '430,500p' src/backend/supervisor-http-server.test.ts
sed -n '740,820p' src/backend/supervisor-http-server.test.ts
sed -n '1,290p' src/supervisor/supervisor-service.test.ts
sed -n '1,220p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '220,420p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1,180p' src/supervisor/supervisor-service.ts
sed -n '1,160p' src/supervisor/supervisor-status-report.ts
sed -n '1,180p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1,180p' src/doctor.ts
apply_patch
npm run build
npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts
git status --short --branch
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T08:38:54Z: reproduced the failing PR build from the GitHub Actions log, fixed the stale test doubles in `supervisor-http-server.test.ts` and `supervisor-service.test.ts`, and re-passed `npm run build` plus `npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts`.
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
