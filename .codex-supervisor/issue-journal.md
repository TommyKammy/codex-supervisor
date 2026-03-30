# Issue #1198: Execution metrics chronology bug: keep stale recovery timestamps from aborting terminal loop transitions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1198
- Branch: codex/issue-1198
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: d4bb3f1578ff9c95af34c5393341f04fe6bf5b99
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T04:37:44.775Z

## Latest Codex Summary
PR `#1199` passed both GitHub build jobs, and I marked it ready for review after confirming there was no surfaced CI failure to repair.

I did not rerun local code verification in this turn because the only new change was the PR state transition after the already-green focused test/build pass. The worktree is still clean aside from untracked supervisor runtime artifacts under `.codex-supervisor/`.

Summary: PR #1199 is ready for review after passing the current GitHub checks
State hint: waiting_ci
Blocked reason: none
Tests: `gh pr checks 1199` showed `build (ubuntu-latest)=pass`, `build (macos-latest)=pass`, and `CodeRabbit=pass (Review skipped)`; prior focused local verification remains `npx tsx --test --test-name-pattern "buildExecutionMetricsRunSummaryArtifact|handlePostTurnMergeAndCompletion keeps blocked tracked-PR state" src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`, `npx tsx --test src/post-turn-pull-request.test.ts`, and `npm run build`
Next action: watch PR #1199 for review feedback or any newly triggered checks after the ready-for-review transition
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale retained `last_recovery_at` values were still feeding recovery timing derivation during terminal execution-metrics persistence, so blocked or done transitions could throw `Invalid execution metrics chronology` even when the terminal state update itself was otherwise valid.
- What changed: reproduced the failure narrowly in execution-metrics lifecycle handling, changed stale recovery timing derivation to degrade to `timeToLatestRecoveryMs: null` instead of throwing, routed the remaining terminal supervisor sync sites in `src/supervisor/supervisor.ts` through `syncExecutionMetricsRunSummarySafely`, added regression coverage for the blocked tracked-PR terminal path, committed the fix, pushed `codex/issue-1198`, opened PR #1199, and marked it ready for review after the current GitHub checks passed.
- Current blocker: none.
- Next exact step: watch PR #1199 for review feedback or any newly triggered checks after the ready-for-review transition and repair anything that surfaces.
- Verification gap: `npm test -- src/...` is not a reliable focused verifier in this repo because the npm wrapper still expands to the suite-wide `src/**/*.test.ts` glob. I used direct `npx tsx --test ...` invocations for the affected files instead. One pre-existing environment-sensitive test in `src/supervisor/supervisor-recovery-failure-flows.test.ts` (`runOnce recovers when post-codex refresh throws after leaving a dirty worktree`) still diverts into stale-state cleanup in this worktree when the whole file runs, which appears unrelated to this change.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`.
- Rollback concern: low. The runtime change is narrowly scoped to stale recovery timing derivation and safe execution-metrics persistence wrapping for terminal supervisor paths.
- Last focused command: `gh pr ready 1199`
- What changed this turn: resumed from the open PR handoff, checked live PR #1199 status, confirmed both GitHub build jobs were passing, marked the PR ready for review, and updated this journal with the new waiting-for-review state.
- Exact failure reproduced this turn: a blocked tracked-PR terminal persistence path with `last_failure_context.updated_at=2026-03-13T00:22:00Z` and retained `last_recovery_at=2026-03-13T00:21:00Z` previously threw `Invalid execution metrics chronology: 2026-03-13T00:22:00Z must be at or before 2026-03-13T00:21:00Z.` while persisting execution metrics.
- Commands run this turn: `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `gh pr checks 1199`; `git status --short`; `gh pr ready 1199`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
