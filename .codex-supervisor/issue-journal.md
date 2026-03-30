# Issue #1198: Execution metrics chronology bug: keep stale recovery timestamps from aborting terminal loop transitions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1198
- Branch: codex/issue-1198
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5068bed67cd7a718b9c53c42bf7f046cb177f624
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T04:16:39.242Z

## Latest Codex Summary
- Hardened execution-metrics chronology handling so stale retained recovery timestamps no longer abort terminal transitions. Derived recovery timing is now omitted when `last_recovery_at` predates the latest failure, and the remaining terminal supervisor persistence sites now use the safe execution-metrics wrapper.

- Added focused regression coverage for the stale-recovery chronology case in the lifecycle builder and for the blocked tracked-PR terminal persistence path in `handlePostTurnMergeAndCompletion`.

Summary: Hardened stale recovery chronology handling, routed remaining terminal execution-metrics sync calls through the safe wrapper, and added focused regressions for the lifecycle builder and blocked tracked-PR terminal path.
State hint: local_review
Blocked reason: none
Tests: `npx tsx --test --test-name-pattern "buildExecutionMetricsRunSummaryArtifact|handlePostTurnMergeAndCompletion keeps blocked tracked-PR state" src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts`; `npm run build`
Next action: stage the fix, commit the focused chronology-hardening change, and open or update the branch for supervisor review.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale retained `last_recovery_at` values were still feeding recovery timing derivation during terminal execution-metrics persistence, so blocked or done transitions could throw `Invalid execution metrics chronology` even when the terminal state update itself was otherwise valid.
- What changed: reproduced the failure narrowly in execution-metrics lifecycle handling, changed stale recovery timing derivation to degrade to `timeToLatestRecoveryMs: null` instead of throwing, routed the remaining terminal supervisor sync sites in `src/supervisor/supervisor.ts` through `syncExecutionMetricsRunSummarySafely`, and added regression coverage for the blocked tracked-PR terminal path.
- Current blocker: none.
- Next exact step: create a checkpoint commit for the chronology-hardening fix and leave the worktree ready for PR/update work.
- Verification gap: `npm test -- src/...` is not a reliable focused verifier in this repo because the npm wrapper still expands to the suite-wide `src/**/*.test.ts` glob. I used direct `npx tsx --test ...` invocations for the affected files instead. One pre-existing environment-sensitive test in `src/supervisor/supervisor-recovery-failure-flows.test.ts` (`runOnce recovers when post-codex refresh throws after leaving a dirty worktree`) still diverts into stale-state cleanup in this worktree when the whole file runs, which appears unrelated to this change.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`.
- Rollback concern: low. The runtime change is narrowly scoped to stale recovery timing derivation and safe execution-metrics persistence wrapping for terminal supervisor paths.
- Last focused command: `npm run build`
- What changed this turn: read the required memory and journal files, traced the chronology throw from `buildRecoveryMetrics()` into the remaining direct terminal sync sites in `src/supervisor/supervisor.ts`, added focused reproductions, implemented the stale-recovery degrade-to-null behavior, wrapped the remaining terminal sync sites with the safe wrapper, reran focused file-scoped tests with `npx tsx --test`, and verified the TypeScript build.
- Exact failure reproduced this turn: a blocked tracked-PR terminal persistence path with `last_failure_context.updated_at=2026-03-13T00:22:00Z` and retained `last_recovery_at=2026-03-13T00:21:00Z` previously threw `Invalid execution metrics chronology: 2026-03-13T00:22:00Z must be at or before 2026-03-13T00:21:00Z.` while persisting execution metrics.
- Commands run this turn: `sed -n '1,220p' /Users/tomoakikawada/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1198/AGENTS.generated.md`; `sed -n '1,220p' /Users/tomoakikawada/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1198/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "Invalid execution metrics chronology|last_recovery_at|execution metrics|execution-metrics" src .`; `git status --short`; `sed -n '1,220p' src/supervisor/execution-metrics-lifecycle.ts`; `sed -n '1,220p' src/supervisor/execution-metrics-run-summary.ts`; `sed -n '180,320p' src/supervisor/supervisor-recovery-failure-flows.test.ts`; `sed -n '1,220p' src/supervisor/execution-metrics-lifecycle.test.ts`; `sed -n '1,260p' src/post-turn-pull-request.test.ts`; `rg -n "syncExecutionMetricsRunSummary\\(|syncExecutionMetricsRunSummarySafely\\(" src`; `sed -n '740,820p' src/supervisor/supervisor.ts`; `sed -n '930,990p' src/supervisor/supervisor.ts`; `sed -n '1,220p' src/turn-execution-publication-gate.ts`; `rg -n "applyCodexTurnPublicationGate\\(|syncExecutionMetricsRunSummary: async|syncExecutionMetricsRunSummary\\(" src/run-once-turn-execution.ts src/post-turn-pull-request.ts src -g'*.ts'`; `sed -n '520,700p' src/run-once-turn-execution.ts`; `sed -n '820,930p' src/supervisor/supervisor.ts`; `sed -n '1,120p' src/supervisor/supervisor-pr-readiness.test.ts`; `npx tsx --test src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test --test-name-pattern "buildExecutionMetricsRunSummaryArtifact|handlePostTurnMergeAndCompletion keeps blocked tracked-PR state" src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npm run build`; `git diff -- src/supervisor/execution-metrics-lifecycle.ts src/supervisor/supervisor.ts src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts .codex-supervisor/issue-journal.md`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
