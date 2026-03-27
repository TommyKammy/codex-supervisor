# Issue #1090: Allow conflicted PR repair to recover from handoff_missing without manual requeue

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1090
- Branch: codex/issue-1090
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 831a596d07433fec5392d7e45801c363bba9162b
- Blocked reason: none
- Last failure signature: handoff-missing
- Repeated failure signature count: 1
- Updated at: 2026-03-27T00:03:14.873Z

## Latest Codex Summary
- Added a narrow recovery path so blocked `handoff_missing` records with an already-open conflicted tracked PR resume into `resolving_conflict` during reconciliation instead of waiting for an operator requeue.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `handoff_missing` should remain a durable blocker by default, but reconciliation can safely resume a blocked repair-lane issue when live tracked-PR facts show the PR is still open and merge-conflicted.
- What changed: updated `reconcileRecoverableBlockedIssueStates()` to inspect tracked PRs for blocked `handoff_missing` records and promote only the open conflicted case back to `resolving_conflict`. Kept `shouldAutoRetryHandoffMissing()` unchanged so non-PR behavior and ordinary blocked selection policy stay intact. Added focused regression coverage for the conflicted tracked-PR path and updated the existing no-PR handoff test to assert the old behavior still holds.
- Current blocker: none locally.
- Next exact step: review the final diff and commit this `#1090` checkpoint on `codex/issue-1090`; if another pass is needed afterward, exercise the full run-once reconciliation path around the blocked conflicted PR case.
- Verification gap: I have not run the full repo suite or an end-to-end supervisor loop; verification so far is focused on execution-policy and recovery-reconciliation tests.
- Files touched: `src/recovery-reconciliation.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-recovery-reconciliation.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The new path is limited to records already blocked on `handoff_missing` with an open tracked PR whose live merge state is conflicted; non-PR and non-conflict cases still follow the prior policy.
- Last focused command: `npx tsx --test src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
- What changed this turn: reread the required memory files, confirmed the branch head was a prior unrelated checkpoint, traced the `handoff_missing` policy and reconciliation flow, implemented a conflicted-PR-specific reconciliation escape hatch into `resolving_conflict`, updated the focused reconciliation tests, and reran the relevant policy/recovery test files.
- Exact failure reproduced this turn: a blocked record with `blocked_reason=handoff_missing` and an already-open tracked PR stayed stranded because `shouldAutoRetryHandoffMissing()` intentionally returns false once `pr_number` is set, so nothing moved the issue back into the conflict-repair lane without a manual requeue.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `git log --oneline --decorate -5`; `git diff --stat`; `rg -n "handoff_missing|blocked_reason|resolving_conflict|mergeable|CONFLICTING|repair lane|requeue|blocked" src test`; `rg --files src test | rg "supervisor|turn-execution|recovery|issue|pull-request|lifecycle|policy|selection|repair"`; `sed -n '1,260p' src/supervisor/supervisor-execution-policy.ts`; `sed -n '1,320p' src/run-once-issue-preparation.ts`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `sed -n '1,260p' src/supervisor/supervisor-lifecycle.ts`; `sed -n '1,320p' src/pull-request-state.ts`; `sed -n '1,320p' src/recovery-reconciliation.test.ts`; `sed -n '1,320p' src/supervisor/supervisor-execution-policy.test.ts`; `sed -n '1,320p' src/run-once-issue-preparation.test.ts`; `rg -n "shouldAutoRetryHandoffMissing|handoff_missing" src/run-once-issue-selection.ts src/run-once-cycle-prelude.ts src/run-once-turn-execution.ts src/supervisor -g'*.ts'`; `rg -n "tracked_pr_head_advanced|resumed issue|recovery event|last_recovery_reason|operator_requeue|handoff" src/recovery-reconciliation.ts src/*test.ts src/supervisor/*test.ts`; `sed -n '1,460p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '520,760p' src/recovery-reconciliation.ts`; `sed -n '1,260p' src/supervisor/supervisor.ts`; `sed -n '120,220p' src/supervisor/supervisor-selection-issue-explain.ts`; `rg -n "function reconcileRecoverableBlockedIssueStates|export async function reconcileRecoverableBlockedIssueStates|reconcileTrackedMergedButOpenIssues|tracked_pr_lifecycle_recovered|tracked_pr_head_advanced" src/recovery-reconciliation.ts`; `sed -n '760,980p' src/recovery-reconciliation.ts`; `sed -n '980,1240p' src/recovery-reconciliation.ts`; `rg -n "CONFLICTING|mergeConflictDetected|resolving_conflict" src/pull-request-state.ts src/pull-request-state-policy.test.ts src/pull-request-state-test-helpers.ts`; `sed -n '320,520p' src/pull-request-state.ts`; `sed -n '1,220p' src/pull-request-state-policy.test.ts`; `sed -n '620,700p' src/pull-request-state.ts`; `sed -n '1,280p' src/run-once-cycle-prelude.ts`; `sed -n '1840,2035p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '2035,2145p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '1,220p' src/supervisor/supervisor-test-helpers.ts`; `rg -n "export function mergeConflictDetected|function mergeConflictDetected" src/supervisor/supervisor-status-rendering.ts src/supervisor/supervisor-reporting.ts`; `sed -n '1,100p' src/supervisor/supervisor-status-rendering.ts`; `rg -n "function applyFailureSignature|export function applyFailureSignature" src/supervisor/supervisor-failure-helpers.ts`; `sed -n '1,220p' src/supervisor/supervisor-failure-helpers.ts`; `rg -n "reconcileRecoverableBlockedIssueStates\\(" -g'*.ts' src`; `git diff -- src/recovery-reconciliation.ts src/supervisor/supervisor.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '1,220p' .codex-supervisor/issue-journal.md`; `git status --short`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
