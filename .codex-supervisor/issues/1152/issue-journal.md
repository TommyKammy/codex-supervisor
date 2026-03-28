# Issue #1152: Rehydrate tracked PR-open issues from live GitHub facts at cycle start

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1152
- Branch: codex/issue-1152
- Workspace: .
- Journal: .codex-supervisor/issues/1152/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 08818020a6547027b7308ef9121793bff28ad1b6
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-28T04:33:56.693Z

## Latest Codex Summary
Implemented cycle-start tracked-PR rehydration for stale blocked lifecycle state and committed it as `0881802` (`Rehydrate tracked blocked PR lifecycle at cycle start`).

The main change is in [src/run-once-cycle-prelude.ts](src/run-once-cycle-prelude.ts) and [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts): selection is now delayed only when tracked PR records actually need live rehydration, blocked tracked PRs with stale `manual_review`/`verification` state are refreshed from live PR/check/review-thread facts, and degraded inventory refresh now still rehydrates those tracked PRs directly. I added focused regressions in [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts) and [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts), and wired the supervisor path in [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts).

Focused verification passed. A broader orchestration run still has one failing test on an issue-label metadata gate (`metadata:labels_unavailable`), which does not appear to be in the tracked-PR rehydration path.

Summary: Rehydrated stale blocked tracked PR lifecycle from live GitHub facts at cycle start, including degraded-refresh fallback, and added focused regressions.
State hint: stabilizing
Blocked reason: verification
Tests: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts` passed; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts` has 1 failing broader test (`runOnce preserves stale no-PR recovery tracking across a successful no-PR turn and converges on the next stale cleanup`)
Next action: Investigate the remaining orchestration test’s label-gate failure and decide whether the fixture should carry labels or the no-PR retry path should bypass that metadata gate
Failure signature: stale-stabilizing-no-pr-recovery-loop

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining orchestration failure was a stale test fixture assumption, not a tracked-PR rehydration regression. The raw `GitHubIssue` fixture for the stale no-PR recovery path omitted `labels`, and current selection correctly blocks missing labels with `metadata:labels_unavailable` instead of treating them as an empty label set.
- What changed: added explicit `labels: []` to the raw issue fixtures in `src/supervisor/supervisor-execution-orchestration.test.ts` that were still relying on the older unlabeled fallback behavior. This keeps the stale no-PR orchestration test aligned with the current issue-metadata contract without widening runtime scope.
- Current blocker: none.
- Next exact step: keep the branch at a clean checkpoint; the tracked-PR rehydration path and the previously failing orchestration suite are both green locally.
- Verification gap: none in the intended issue path. There are still non-fatal execution-metrics chronology warnings emitted by some tests, but they did not fail the focused or broader suites exercised here.
- Files touched: src/run-once-cycle-prelude.ts; src/recovery-reconciliation.ts; src/supervisor/supervisor.ts; src/run-once-cycle-prelude.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-execution-orchestration.test.ts
- Rollback concern: low for this checkpoint; the new edit is test-only and constrains fixtures to supply labels explicitly.
- Last focused commands: `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
