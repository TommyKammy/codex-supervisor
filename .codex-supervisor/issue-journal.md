# Issue #897: Execution metrics replay exposure: surface metrics in replay and debugging workflows

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/897
- Branch: codex/issue-897
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0da2629ed3f70a50fbabee98a2c581f76f6b0df8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T20:58:47.000Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: execution metrics were already being persisted per workspace, but replay and active debugging surfaces never summarized them; loading the existing run summary artifact should expose bottlenecks without affecting replay decisions.
- What changed: added `src/supervisor/execution-metrics-debugging.ts` to validate and summarize `.codex-supervisor/execution-metrics/run-summary.json`, wired those lines into `handleReplayCommand()` output and active issue status summary lines, and added focused coverage in `src/supervisor/execution-metrics-replay.test.ts` plus status-loading assertions in `src/supervisor/supervisor-selection-status-active-status.test.ts`.
- Current blocker: none
- Next exact step: review the diff once more, commit the replay/debugging metrics exposure changes on `codex/issue-897`, and open or update the draft PR if one does not already exist.
- Verification gap: no known functional gap in the replay/status surfaces covered here; broader supervisor status and explain workflows still rely on existing coverage outside this focused slice.
- Files touched: `src/cli/replay-command.ts`, `src/supervisor/execution-metrics-debugging.ts`, `src/supervisor/execution-metrics-replay.test.ts`, `src/supervisor/supervisor-cycle-replay.ts`, `src/supervisor/supervisor-selection-active-status.ts`, `src/supervisor/supervisor-selection-status-active-status.test.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change is observational-only and reads the existing execution metrics artifact without changing execution state transitions or replay decision inputs.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` because `node_modules/` was absent in this worktree; `npm ci` restored dependencies and the build then passed.
- Last focused commands:
```bash
sed -n '1,220p' '<memory>/AGENTS.generated.md'
sed -n '1,220p' '<memory>/context-index.md'
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
rg -n "execution metrics|executionMetrics|replay|debug" src . --glob '!node_modules'
rg --files src | rg 'execution|replay|snapshot|debug|supervisor'
sed -n '1,260p' src/supervisor/supervisor-cycle-snapshot.ts
sed -n '1,320p' src/supervisor/supervisor-cycle-replay.ts
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.ts
sed -n '1,360p' src/supervisor/supervisor-cycle-snapshot.test.ts
sed -n '1,320p' src/supervisor/supervisor-cycle-replay.test.ts
sed -n '1,260p' src/cli/replay-command.ts
sed -n '1,260p' src/cli/replay-handlers.test.ts
rg -n "run-summary|executionMetricsRunSummary|execution-metrics" src/supervisor src/cli
sed -n '1,320p' src/supervisor/supervisor-status-rendering.ts
sed -n '1,360p' src/supervisor/supervisor-status-model.ts
sed -n '1,260p' src/supervisor/supervisor-selection-active-status.ts
sed -n '1,360p' src/supervisor/supervisor-selection-status-active-status.test.ts
sed -n '900,1040p' src/supervisor/supervisor.ts
apply_patch
apply_patch
npx tsx --test src/supervisor/execution-metrics-replay.test.ts
npx tsx --test src/supervisor/supervisor-selection-status-active-status.test.ts
npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts
npx tsx --test src/supervisor/execution-metrics-replay.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts
npm run build
test -d node_modules && echo present || echo missing
sed -n '1,220p' package.json
ls | rg 'package-lock.json|pnpm-lock.yaml|yarn.lock'
npm ci
npm run build
git diff -- src/cli/replay-command.ts src/supervisor/execution-metrics-debugging.ts src/supervisor/execution-metrics-replay.test.ts src/supervisor/supervisor-cycle-replay.ts src/supervisor/supervisor-selection-active-status.ts src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-status-model.ts src/supervisor/supervisor.ts
date -u +"%Y-%m-%dT%H:%M:%S.000Z"
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
