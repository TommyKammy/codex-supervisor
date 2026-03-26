# Issue #1061: Allow one bounded follow-up repair turn after partial configured-bot review progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1061
- Branch: codex/issue-1061
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 636a6bbe9c93ce2080e8c90009b393579af45712
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T10:59:12.003Z

## Latest Codex Summary
- Added bounded same-head configured-bot review follow-up tracking so one extra repair turn is allowed only after measurable current-head progress, with direct state and status visibility for eligible vs exhausted follow-up states.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the current review-repair stop path is keyed only on whether same-head configured-bot threads were already processed, so once the first repair turn completes the state machine cannot distinguish no-progress failures from partial-progress cases that should get one bounded retry.
- What changed: added persisted same-head follow-up allowance fields on the issue record, taught the review lifecycle and turn-selection helpers to allow exactly one extra configured-bot repair turn when the prior current-head pass measurably reduced or retired part of the configured-bot thread set, and updated stalled-review failure/status reporting to distinguish `eligible` vs `exhausted` same-head follow-up state.
- Current blocker: none locally.
- Next exact step: review the final diff, commit the bounded follow-up patchset on `codex/issue-1061`, and leave the worktree ready for PR/update handling.
- Verification gap: broader full-suite verification is still outstanding; this turn covered the focused current-head configured-bot thread tests, orchestration follow-up selection tests, status rendering coverage, and `npm run build`.
- Files touched: `src/core/types.ts`, `src/core/state-store.ts`, `src/review-thread-reporting.ts`, `src/pull-request-state.ts`, `src/run-once-turn-execution.ts`, `src/turn-execution-orchestration.ts`, `src/supervisor/supervisor-failure-context.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, focused tests, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low-moderate. The change is narrowly scoped to configured-bot same-head repair handling, but it adds new persisted record fields and reuses them in both lifecycle inference and prompt thread selection.
- Last focused command: `npm run build`
- What changed this turn: reproduced the issue at the state-machine boundary with focused tests, added one bounded current-head follow-up allowance only when configured-bot thread progress is observed after a repair turn, reused that allowance in turn thread selection so the second pass can actually execute, and surfaced the allowance in status plus stalled-review failure context.
- Exact failure reproduced this turn: after a configured-bot repair turn processed same-head review threads and left one unresolved thread behind, the supervisor immediately transitioned to `blocked/manual_review` because the unresolved thread was now treated as permanently processed on that head, even if another thread from the same current-head set had been resolved or become outdated.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1061/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1061/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "manual_review|configured-bot|review-repair|follow-up" src . -g '!dist'`; `sed -n '1,260p' src/pull-request-state-thread-reprocessing.test.ts`; `sed -n '1,260p' src/pull-request-state.ts`; `sed -n '1,260p' src/review-handling.ts`; `sed -n '1,260p' src/pull-request-state-test-helpers.ts`; `sed -n '1,260p' src/review-thread-reporting.ts`; `sed -n '1,260p' src/core/types.ts`; `sed -n '1,260p' src/post-turn-pull-request.ts`; `sed -n '1,220p' src/turn-execution-orchestration.ts`; `sed -n '1,220p' src/supervisor/supervisor-failure-context.ts`; `sed -n '80,220p' src/supervisor/supervisor-detailed-status-assembly.ts`; `apply_patch ...`; `npx tsx --test src/pull-request-state-thread-reprocessing.test.ts`; `npx tsx --test src/turn-execution-orchestration.test.ts`; `npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm ci`; `npm run build`; `git status --short`.
- PR status: none yet for this branch.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local
