# Issue #912: Execution metrics durability: retain run summaries beyond worktree cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/912
- Branch: codex/issue-912
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d0a58c906a8e042ba9a289be9e5d80b22293d27c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T23:17:06.037Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: execution-metrics durability should keep the per-worktree `run-summary.json` for local debugging, but also retain a second copy under a supervisor-owned path derived from `stateFile` so worktree cleanup cannot delete the aggregation source; daily rollups should read from that retained store through a supported CLI/runtime command.
- What changed: added retained execution-metrics path helpers in `src/supervisor/execution-metrics-run-summary.ts`; `syncExecutionMetricsRunSummary()` now writes the existing worktree-local artifact and an optional retained copy under `<dirname(stateFile)>/execution-metrics/run-summaries/issue-<n>.json`; added retained-summary discovery and `syncRetainedExecutionMetricsDailyRollups()` in `src/supervisor/execution-metrics-aggregation.ts`; threaded the retention root through terminal summary writes in the preparation, execution, recovery, and supervisor failure paths; added the operator command `rollup-execution-metrics` through `src/core/types.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`, and `src/supervisor/supervisor-mutation-report.ts`; documented the retained summary and rollup locations in `README.md` and `docs/getting-started.md`.
- Current blocker: none
- Next exact step: stage the issue-912 changes, create a checkpoint commit on `codex/issue-912`, and open or update a draft PR if one does not already exist.
- Verification gap: no known local gap in the targeted durability and rollup paths; broader full-suite coverage was not rerun beyond the focused execution-metrics, runtime, and recovery tests plus `npm run build`.
- Files touched: `src/supervisor/execution-metrics-run-summary.ts`, `src/supervisor/execution-metrics-aggregation.ts`, `src/run-once-issue-preparation.ts`, `src/run-once-turn-execution.ts`, `src/turn-execution-failure-helpers.ts`, `src/supervisor/supervisor-failure-helpers.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor-mutation-report.ts`, `src/core/types.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/execution-metrics-schema.test.ts`, `src/supervisor/execution-metrics-aggregation.test.ts`, `src/cli/parse-args.test.ts`, `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`, `README.md`, `docs/getting-started.md`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the changes only add retained observational artifacts and a new operator-triggered rollup path, without altering supervisor execution decisions or worktree cleanup eligibility.
- Last focused command: `npx tsx --test src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-aggregation.test.ts src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts src/supervisor/supervisor-service.test.ts && npm run build`
- Last focused failure: initial `npm run build` failed because `node_modules` was absent and `tsc` was not installed in the worktree; `npm ci` resolved the environment issue and the rerun passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-912/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-912/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
rg -n "execution metrics|execution-metrics|run summary|run-summary|daily rollup|rollup|aggregate" src docs
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,280p' src/supervisor/execution-metrics-aggregation.ts
sed -n '1,320p' src/supervisor/execution-metrics-aggregation.test.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.ts
sed -n '1,240p' src/cli/entrypoint.ts
sed -n '1,260p' src/cli/parse-args.ts
sed -n '1,240p' src/cli/supervisor-runtime.ts
sed -n '1,260p' src/supervisor/supervisor-service.ts
sed -n '1,260p' src/core/types.ts
sed -n '200,270p' src/core/workspace.ts
apply_patch
apply_patch
apply_patch
npx tsx --test src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-aggregation.test.ts src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-service.test.ts
npm run build
test -d node_modules && echo present || echo missing
sed -n '1,220p' package.json
ls | rg 'package-lock.json|pnpm-lock.yaml|yarn.lock'
npm ci
npx tsx --test src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-aggregation.test.ts src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts src/supervisor/supervisor-service.test.ts
npm run build
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
