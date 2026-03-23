# Issue #864: Stale recovery visibility: surface repeated stale cleanup risk in status and replay

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/864
- Branch: codex/issue-864
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 423f3683bd67977494c916493838a3b954c6e43f
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 2
- Updated at: 2026-03-23T03:23:20.570Z

## Latest Codex Summary
Added focused stale-loop visibility for issue #864. Status and explain now emit a `stale_recovery_warning` when a stabilizing issue keeps re-entering stale no-PR recovery, and replay cycle snapshots now retain `stale_stabilizing_no_pr_recovery_count` so the pattern survives after-the-fact inspection. I also added narrow regressions in [src/supervisor/supervisor-diagnostics-status-selection.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-864/src/supervisor/supervisor-diagnostics-status-selection.test.ts), [src/supervisor/supervisor-selection-issue-explain.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-864/src/supervisor/supervisor-selection-issue-explain.test.ts), and [src/supervisor/supervisor-cycle-snapshot.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-864/src/supervisor/supervisor-cycle-snapshot.test.ts).

Committed as `15f07e6` and `423f368`, pushed `codex/issue-864`, and opened draft PR `#869`: https://github.com/TommyKammy/codex-supervisor/pull/869. The only remaining worktree dirt is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Surfaced repeated stale no-PR recovery risk in status/explain, persisted the stale recovery counter in replay snapshots, added focused tests, and opened draft PR #869.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts`
Failure signature: none
Next action: monitor draft PR #869 for CI and review feedback, then address any follow-up if checks fail or reviewers request changes

## Active Failure Context
- Category: checks
- Summary: PR #869 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/869
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23419803218/job/68122332843
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23419803218/job/68122332839

## Codex Working Notes
### Current Handoff
- Hypothesis: PR #869's build failure came from follow-on test fixtures, not the stale-recovery feature itself; `SupervisorExplainDto` added a required `staleRecoveryWarningSummary` field, and backend/browser smoke test doubles plus one HTTP JSON expectation still encoded the old DTO shape.
- What changed: added `staleRecoveryWarningSummary: null` to the affected `queryExplain` test doubles in `src/backend/supervisor-http-server.test.ts` and `src/backend/webui-dashboard-browser-smoke.test.ts`, and updated the read-only HTTP response expectation to match the expanded DTO.
- Current blocker: none
- Next exact step: watch PR #869's rerun to completion and only investigate further if `build (ubuntu-latest)` regresses after commit `79d1b21`.
- Verification gap: local `npm run build` and a focused mixed backend/supervisor test suite are green; the rerun has only partially completed on GitHub so far (`macos-latest` passed, `ubuntu-latest` pending).
- Files touched: `src/no-pull-request-state.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-cycle-snapshot.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-cycle-snapshot.test.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard-browser-smoke.test.ts`
- Rollback concern: low; the repair is limited to test fixtures and one test expectation so runtime behavior is unchanged, but future `SupervisorExplainDto` additions could trigger similar fixture drift if test doubles stay handwritten.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard-browser-smoke.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts`
- Last focused failure: `build:ts2322-supervisor-explain-dto-missing-staleRecoveryWarningSummary`
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
- 2026-03-23T03:26:13Z: committed the CI repair as `79d1b21` (`Fix explain DTO test fixtures`) and pushed `codex/issue-864`; PR #869 reran immediately, with `build (macos-latest)` passing and `build (ubuntu-latest)` still pending at the time of this note.
- 2026-03-23T03:25:00Z: reproduced PR #869's `npm run build` failure from Actions via `gh run view 23419803218 --log-failed`; TypeScript reported `TS2322` in `src/backend/supervisor-http-server.test.ts` and `src/backend/webui-dashboard-browser-smoke.test.ts` because `SupervisorExplainDto` now requires `staleRecoveryWarningSummary`.
- 2026-03-23T03:25:00Z: repaired the failing backend test doubles/expectation, then passed `npm run build` and `npx tsx --test src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard-browser-smoke.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
