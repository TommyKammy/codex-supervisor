# Issue #1061: Allow one bounded follow-up repair turn after partial configured-bot review progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1061
- Branch: codex/issue-1061
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 5fe971f97fd5778743b35edf8341e9f84ad05ee5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T11:14:37Z

## Latest Codex Summary
Implemented and pushed as `5fe971f` (`Allow one bounded same-head review follow-up`), then opened draft PR `#1066`.

The change adds a persisted same-head follow-up allowance for configured-bot review repair, grants it only when the first current-head repair turn made measurable progress, reuses that allowance when selecting review threads for the next Codex turn, and reports `eligible` vs `exhausted` in status/failure output. Focused tests and `npm run build` were rerun successfully in this worktree before publishing the branch and draft PR.

Summary: Added one bounded same-head configured-bot review follow-up after partial progress, verified it locally again, pushed `codex/issue-1061`, and opened draft PR `#1066`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-thread-reprocessing.test.ts src/turn-execution-orchestration.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
Next action: monitor PR `#1066` for CI or review feedback and address any follow-up issues on `codex/issue-1061`
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the current review-repair stop path is keyed only on whether same-head configured-bot threads were already processed, so once the first repair turn completes the state machine cannot distinguish no-progress failures from partial-progress cases that should get one bounded retry.
- What changed: added persisted same-head follow-up allowance fields on the issue record, taught the review lifecycle and turn-selection helpers to allow exactly one extra configured-bot repair turn when the prior current-head pass measurably reduced or retired part of the configured-bot thread set, and updated stalled-review failure/status reporting to distinguish `eligible` vs `exhausted` same-head follow-up state.
- Current blocker: none locally.
- Next exact step: watch draft PR `#1066`, then address CI or reviewer feedback if any appears on the pushed branch.
- Verification gap: broader full-suite verification is still outstanding; this turn reran the focused current-head configured-bot thread tests, orchestration follow-up selection tests, status rendering coverage, and `npm run build`.
- Files touched: `src/core/types.ts`, `src/core/state-store.ts`, `src/review-thread-reporting.ts`, `src/pull-request-state.ts`, `src/run-once-turn-execution.ts`, `src/turn-execution-orchestration.ts`, `src/supervisor/supervisor-failure-context.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, focused tests, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low-moderate. The change is narrowly scoped to configured-bot same-head repair handling, but it adds new persisted record fields and reuses them in both lifecycle inference and prompt thread selection.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1061 ...`
- What changed this turn: verified the committed bounded same-head follow-up behavior again with focused tests and a build, pushed `codex/issue-1061` to `origin/codex/issue-1061`, retried PR creation after the remote branch propagated, and opened draft PR `#1066`.
- Exact failure reproduced this turn: none; the only transient failure was an initial `gh pr create` GraphQL response before GitHub recognized the freshly pushed branch refs.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1061/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1061/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 5`; `gh pr status`; `git show --stat --summary --decorate HEAD`; `git diff -- src/core/types.ts src/core/state-store.ts src/review-thread-reporting.ts src/pull-request-state.ts src/run-once-turn-execution.ts src/turn-execution-orchestration.ts src/supervisor/supervisor-failure-context.ts src/supervisor/supervisor-detailed-status-assembly.ts src/pull-request-state-thread-reprocessing.test.ts src/turn-execution-orchestration.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `git branch -vv`; `npx tsx --test src/pull-request-state-thread-reprocessing.test.ts src/turn-execution-orchestration.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`; `git push -u origin codex/issue-1061`; `git log --oneline origin/main..origin/codex/issue-1061`; `gh repo view --json defaultBranchRef,nameWithOwner`; `gh pr list --head codex/issue-1061 --state all`; `gh pr create --draft --base main --head codex/issue-1061 ...`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `apply_patch ...`.
- PR status: draft PR open: `#1066` (`https://github.com/TommyKammy/codex-supervisor/pull/1066`).
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local
