# Issue #1008: Interrupted turn recovery: detect and reconcile in-progress Codex turns that end without a durable handoff

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1008
- Branch: codex/issue-1008
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dba48aa4f32fa5c40b1d27f87618fdfb941e568d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T16:30:48.470Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: restart ambiguity comes from the gap between `prepareCodexTurnPrompt` and the first durable post-turn write; if the process exits there, the supervisor only sees missing locks and cannot distinguish an interrupted turn from a stale reservation.
- What changed: added a narrow workspace marker in `src/interrupted-turn-marker.ts`, wrote it immediately before `agentRunner.runTurn`, cleared it after known completion paths in `src/run-once-turn-execution.ts`, taught `reconcileStaleActiveIssueReservation` in `src/recovery-reconciliation.ts` to convert an unconsumed marker into an explicit blocked `handoff_missing` recovery, ignored the marker in `src/supervisor/supervisor.ts` workspace-drift checks, and added focused regressions in `src/run-once-turn-execution.test.ts` and `src/supervisor/supervisor-execution-orchestration.test.ts`.
- Current blocker: none.
- Next exact step: review the diff for naming and recovery-message precision, then commit the interrupted-turn recovery slice on `codex/issue-1008`.
- Verification gap: none after `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build`.
- Files touched: `src/interrupted-turn-marker.ts`; `src/run-once-turn-execution.ts`; `src/recovery-reconciliation.ts`; `src/supervisor/supervisor.ts`; `src/run-once-turn-execution.test.ts`; `src/supervisor/supervisor-execution-orchestration.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the runtime change is limited to a supervisor-owned marker file plus restart reconciliation, but stale-marker handling now influences active-issue recovery and should not be partially reverted.
- Last focused command: `npm run build`
- Exact failure reproduced: an active issue with missing issue/session locks and a persisted `turn-in-progress` marker was previously reconciled as generic stale cleanup, which silently dropped the fact that Codex had started without leaving a durable handoff.
- Commands run: `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1008/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1008/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,260p' src/run-once-turn-execution.test.ts`; `sed -n '1,320p' src/supervisor/supervisor-execution-orchestration.test.ts`; `rg -n "executeCodexTurnPhase|recoverUnexpectedCodexTurnFailure|codex_session_id|structuredResult|supervisorMessage|runTurn\\(" src/run-once-turn-execution.ts src/supervisor -g'*.ts'`; `sed -n '1,340p' src/run-once-turn-execution.ts`; `sed -n '430,820p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '1,260p' src/core/types.ts`; `sed -n '120,260p' src/supervisor/supervisor-failure-helpers.ts`; `sed -n '1,340p' src/turn-execution-orchestration.ts`; `sed -n '340,760p' src/run-once-turn-execution.ts`; `sed -n '1233,1415p' src/recovery-reconciliation.ts`; `sed -n '1,180p' src/supervisor/supervisor-execution-policy.ts`; `sed -n '1,260p' src/turn-execution-failure-helpers.ts`; `sed -n '180,230p' src/supervisor/supervisor.ts`; `sed -n '1,220p' src/core/utils.ts`; `sed -n '1010,1115p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1115,1185p' src/supervisor/supervisor-execution-cleanup.test.ts`; `npm exec tsc -- --noEmit`; `npx tsx --test src/run-once-turn-execution.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`; `test -d node_modules && echo node_modules-present || echo node_modules-missing`; `test -f package-lock.json && echo lock-present || echo lock-missing`; `sed -n '1,220p' package.json`; `npm ci`; `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`; `git diff --check -- src/interrupted-turn-marker.ts src/run-once-turn-execution.ts src/recovery-reconciliation.ts src/supervisor/supervisor.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: none yet on this branch.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
