# Issue #1277: Tracked PR recovery can remain stuck in failed local state after fresh PR head is observed

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1277
- Branch: codex/issue-1277
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 7 (implementation=7, repair=0)
- Last head SHA: 1358cf5e5e3ab84902fb7ec77411ed6aec1a183f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-01T23:40:21.729Z

## Latest Codex Summary
- Reset tracked-PR recovery convergence to clear exhausted repair-lane counters when fresh GitHub PR facts resume the issue, and added same-head `failed -> addressing_review` regression coverage through reconciliation, runOnce, explain, and status paths.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: same-cycle selection was reasserting `failed` after tracked-PR recovery because the stale exhausted `repair_attempt_count` survived recovery into the resumed `addressing_review` state.
- What changed: `buildTrackedPrStaleFailureConvergencePatch` now resets `repair_attempt_count` alongside the existing stale-failure cleanup, and regression coverage now exercises same-head `failed -> addressing_review` recovery in reconciliation, `runOnce`, `explain`, and `status`.
- Current blocker: none.
- Next exact step: review the diff, then push `codex/issue-1277` and open/update the draft PR if requested.
- Verification gap: none on the requested local test/build surface.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`.
- Rollback concern: low; the runtime change is limited to tracked-PR stale-failure convergence and only resets the repair lane when fresh PR facts are accepted.
- Last focused command: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
