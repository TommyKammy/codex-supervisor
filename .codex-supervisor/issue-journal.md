# Issue #1198: Execution metrics chronology bug: keep stale recovery timestamps from aborting terminal loop transitions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1198
- Branch: codex/issue-1198
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 320f8a9f243e4c79833ef64b8a164475bf5c26be
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T04:29:29.031Z

## Latest Codex Summary
Implemented the chronology hardening on `codex/issue-1198` in commits `320f8a9f243e4c79833ef64b8a164475bf5c26be` and `c8d2125e31f02f4f44dc7c9cc074f2022fe7d2a7`, pushed the branch, and opened draft PR `#1199`.

The fix does two things. In [execution-metrics-lifecycle.ts](src/supervisor/execution-metrics-lifecycle.ts), stale retained recovery timestamps no longer throw when they predate the latest failure; the code now keeps the recovery record but drops the derived `timeToLatestRecoveryMs`. In [supervisor.ts](src/supervisor/supervisor.ts), the remaining terminal execution-metrics persistence paths now go through the safe wrapper so chronology-only issues cannot abort terminal loop transitions.

I added focused regressions in [execution-metrics-lifecycle.test.ts](src/supervisor/execution-metrics-lifecycle.test.ts) and [supervisor-recovery-failure-flows.test.ts](src/supervisor/supervisor-recovery-failure-flows.test.ts). I also updated the issue journal at [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md).

Summary: Pushed the chronology-hardening fix and opened draft PR #1199.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test --test-name-pattern "buildExecutionMetricsRunSummaryArtifact|handlePostTurnMergeAndCompletion keeps blocked tracked-PR state" src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts`; `npm run build` (note: `npm test -- src/...` still expands to the repo-wide suite in this repo, and one unrelated environment-sensitive test in `src/supervisor/supervisor-recovery-failure-flows.test.ts` still diverts into stale-state cleanup when the whole file runs)
Next action: monitor PR #1199 checks and address any CI or review feedback that appears.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale retained `last_recovery_at` values were still feeding recovery timing derivation during terminal execution-metrics persistence, so blocked or done transitions could throw `Invalid execution metrics chronology` even when the terminal state update itself was otherwise valid.
- What changed: reproduced the failure narrowly in execution-metrics lifecycle handling, changed stale recovery timing derivation to degrade to `timeToLatestRecoveryMs: null` instead of throwing, routed the remaining terminal supervisor sync sites in `src/supervisor/supervisor.ts` through `syncExecutionMetricsRunSummarySafely`, added regression coverage for the blocked tracked-PR terminal path, committed the fix, pushed `codex/issue-1198`, and opened draft PR #1199.
- Current blocker: none.
- Next exact step: watch PR #1199 for CI or review feedback and repair anything that surfaces.
- Verification gap: `npm test -- src/...` is not a reliable focused verifier in this repo because the npm wrapper still expands to the suite-wide `src/**/*.test.ts` glob. I used direct `npx tsx --test ...` invocations for the affected files instead. One pre-existing environment-sensitive test in `src/supervisor/supervisor-recovery-failure-flows.test.ts` (`runOnce recovers when post-codex refresh throws after leaving a dirty worktree`) still diverts into stale-state cleanup in this worktree when the whole file runs, which appears unrelated to this change.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`.
- Rollback concern: low. The runtime change is narrowly scoped to stale recovery timing derivation and safe execution-metrics persistence wrapping for terminal supervisor paths.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1198 --title "[codex] Keep stale recovery timestamps from aborting terminal loop transitions" ...`
- What changed this turn: resumed from the committed chronology fix, confirmed the branch had no PR, committed the tracked journal handoff update, pushed `codex/issue-1198`, opened draft PR #1199, and updated this journal with the new review state.
- Exact failure reproduced this turn: a blocked tracked-PR terminal persistence path with `last_failure_context.updated_at=2026-03-13T00:22:00Z` and retained `last_recovery_at=2026-03-13T00:21:00Z` previously threw `Invalid execution metrics chronology: 2026-03-13T00:22:00Z must be at or before 2026-03-13T00:21:00Z.` while persisting execution metrics.
- Commands run this turn: `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `gh pr status`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "Update issue 1198 journal handoff"`; `git push origin codex/issue-1198`; `git rev-parse --short HEAD`; `gh pr create --draft --base main --head codex/issue-1198 --title "[codex] Keep stale recovery timestamps from aborting terminal loop transitions" --body ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
