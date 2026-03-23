# Issue #911: Execution metrics bug: keep run-summary validation from breaking legitimate terminal paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/911
- Branch: codex/issue-911
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6a13cc8f9dddd41fc8687de7cef94f2eb43675ec
- Blocked reason: none
- Last failure signature: run_summary_finished_at_lags_failure_or_recovery
- Repeated failure signature count: 0
- Updated at: 2026-03-23T22:23:05Z

## Latest Codex Summary
- Reproduced issue #911 in focused integration tests: legitimate merged-PR, closed-PR, and local-CI-blocked terminal paths threw during execution-metrics run-summary validation because `finishedAt` came from the record timestamp while failure/recovery observations could be later.
- Fixed `buildExecutionMetricsRunSummaryArtifact()` to normalize the metrics artifact `finishedAt` to the latest of the record timestamp, latest failure observation, and latest recovery observation, keeping metrics persistence observational-only and preserving supervisor terminal-state semantics.
- Added focused regression coverage in `src/supervisor/execution-metrics-failure-recovery.test.ts`; verified with the prescribed test command plus `npm run build` after restoring dependencies with `npm ci`.

## Active Failure Context
- Resolved locally: `Invalid execution metrics run summary: recoveryMetrics.lastRecoveredAt must not be after finishedAt.` and `Invalid execution metrics run summary: failureMetrics.lastOccurredAt must not be after finishedAt.`

## Codex Working Notes
### Current Handoff
- Hypothesis: execution-metrics summaries should treat terminal `updated_at` as a lower bound, not a hard upper bound, because legitimate terminal transitions can record failure or recovery observations slightly later than the record timestamp.
- What changed: updated `src/supervisor/execution-metrics-lifecycle.ts` so the run-summary artifact `finishedAt` becomes the latest of the terminal record timestamp, `failureMetrics.lastOccurredAt`, and `recoveryMetrics.lastRecoveredAt`; added regression coverage in `src/supervisor/execution-metrics-failure-recovery.test.ts` for the late-failure/late-recovery case.
- Current blocker: none
- Next exact step: commit the focused run-summary normalization fix on `codex/issue-911`, then open or update the draft PR for this issue branch.
- Verification gap: no known local gap in the targeted terminal-path regressions; broader execution-metrics aggregation/reporting coverage was not rerun beyond the prescribed issue checks and the focused lifecycle unit coverage.
- Files touched: `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-failure-recovery.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change only broadens the summary artifact timestamp envelope so validation reflects legitimate terminal observations and cannot redirect supervisor control flow.
- Last focused command: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-schema.test.ts`
- Last focused failure: before the fix, focused tests failed with `Invalid execution metrics run summary: recoveryMetrics.lastRecoveredAt must not be after finishedAt.` and `Invalid execution metrics run summary: failureMetrics.lastOccurredAt must not be after finishedAt.`; separately, `npm run build` initially failed with `sh: 1: tsc: not found` until `npm ci` restored `node_modules`.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-911/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-911/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
rg -n "run-summary|executionMetricsRunSummary|terminal.*path|closed|merged|local ci|local-CI|unexpected-failure|metrics validation|execution metrics" src
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.ts
sed -n '240,420p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '430,620p' src/run-once-issue-preparation.test.ts
sed -n '360,520p' src/run-once-turn-execution.test.ts
sed -n '1,260p' src/supervisor/execution-metrics-lifecycle.ts
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-schema.test.ts
sed -n '300,430p' src/supervisor/execution-metrics-schema.ts
sed -n '300,380p' src/run-once-turn-execution.test.ts
rg -n "buildCodexFailureContext\(|updated_at: now\(|updated_at:" src | sed -n '1,200p'
rg -n "function buildRecoveryEvent|const buildRecoveryEvent|buildRecoveryEvent\(" src | sed -n '1,120p'
apply_patch
apply_patch
npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-schema.test.ts
npm run build
test -d node_modules && echo present || echo missing
sed -n '1,220p' package.json
ls | rg 'package-lock.json|pnpm-lock.yaml|yarn.lock'
npm ci
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-schema.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
