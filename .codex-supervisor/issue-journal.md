# Issue #883: Local CI config surface: add an optional repo-owned pre-PR verification command

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/883
- Branch: codex/issue-883
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1e0d274797c06cfc82af609375fb9521286ce0fa
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T13:35:46Z

## Latest Codex Summary
- Added optional `localCiCommand` config support plus typed local CI contract summaries for setup-readiness, doctor, and status surfaces; focused verification and requested verification now pass after restoring local npm dependencies in this worktree.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: this issue is a narrow typed-surface gap; supervisor config needs an optional repo-owned `localCiCommand`, and setup-readiness/doctor/status should report whether that contract exists without making it a required setup blocker.
- What changed: added `localCiCommand` to `SupervisorConfig` parsing, introduced a shared typed local CI contract summary helper, surfaced that summary through `diagnoseSetupReadiness`, `diagnoseSupervisorHost`, and `Supervisor.statusReport`, rendered `doctor_local_ci` and `local_ci` lines, added focused regressions in `src/config.test.ts`, `src/doctor.test.ts`, and `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, extended `src/supervisor/supervisor-service.test.ts`, and exposed the optional field in `supervisor.config.example.json`.
- Current blocker: none
- Next exact step: commit the local CI contract surface change on `codex/issue-883`, then push and open or update a draft PR if one does not already exist.
- Verification gap: none on the requested issue verification surface.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/setup-readiness.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-service.test.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor.ts`, `supervisor.config.example.json`
- Rollback concern: low; the change is additive and optional, but removing it would require backing out the new typed status/setup/doctor surface and the config parser field together.
- Last focused command: `npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Last focused failure: the initial focused reproducer failed because `localCiCommand` was not parsed and the setup-readiness/doctor local CI summaries were missing; later `npm run build` failed with `sh: 1: tsc: not found` until `npm install` restored local dependencies in this worktree.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-883/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-883/context-index.md
sed -n '1,360p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "localCi|local CI|pre-PR|pre-pr|verification entrypoint|doctor|setup readiness|setup-readiness|supervisor status|SupervisorStatus|readiness" src supervisor.config.example.json docs -g '*.ts' -g '*.json' -g '*.md'
rg --files src | rg 'config|doctor|supervisor-service|status|setup|readiness'
sed -n '1,260p' src/core/config.ts
sed -n '1,260p' src/config.test.ts
sed -n '1,260p' src/setup-readiness.ts
sed -n '1,320p' src/doctor.ts
sed -n '1,360p' src/supervisor/supervisor-service.ts
sed -n '1,420p' src/supervisor/supervisor-service.test.ts
sed -n '1,260p' src/supervisor/supervisor-status-model.ts
rg -n "interface SupervisorConfig|type SupervisorConfig|SetupReadinessReport|DoctorDiagnostics|SupervisorStatusDto|localReviewSummaryPath|verificationPolicySummary" src/core/types.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor.ts src/doctor.test.ts
sed -n '1,340p' src/core/types.ts
sed -n '1,260p' src/supervisor/supervisor-status-report.ts
sed -n '820,980p' src/supervisor/supervisor.ts
sed -n '230,340p' src/doctor.test.ts
sed -n '260,620p' src/core/config.ts
sed -n '320,520p' src/doctor.ts
sed -n '520,660p' src/doctor.ts
apply_patch
npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-service.test.ts
sed -n '300,380p' src/doctor.test.ts
sed -n '150,240p' src/supervisor/supervisor-service.test.ts
sed -n '240,330p' src/config.test.ts
apply_patch
sed -n '1,260p' src/setup-readiness.ts
sed -n '1,120p' src/core/config.ts
sed -n '1,120p' src/supervisor/supervisor.ts
sed -n '260,420p' src/setup-readiness.ts
apply_patch
rg -n "kind: \"setup_readiness\"|overallStatus: \"pass\"|candidateDiscoverySummary:|candidateDiscovery: null,|trustPosture:" src -g '*.test.ts' -g '*.ts'
rg -n "interface DoctorDiagnostics|DoctorDiagnostics =|renderDoctorReport\\(|statusReport: Awaited<ReturnType<StubSupervisor\\[\\\"statusReport\\\"\\]>> =|SupervisorStatusDto" src -g '*.test.ts' -g '*.ts'
apply_patch
rg -n "function createSupervisorFixture|createSupervisorFixture\\(" src/supervisor/supervisor-test-helpers.ts
sed -n '196,250p' src/supervisor/supervisor-test-helpers.ts
apply_patch
npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm run build
npm install
npm run build
npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-service.test.ts
apply_patch
npx tsx --test src/config.test.ts
git diff -- src/core/types.ts src/core/config.ts src/setup-readiness.ts src/doctor.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor.ts src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts supervisor.config.example.json
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
