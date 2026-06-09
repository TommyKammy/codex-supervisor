# Phase 4 Closeout Evidence

Phase 4 promotes PR lifecycle action selection into Decision Kernel v2 while keeping the existing merge execution adapter and issue selection loop boundaries intact.

## Evidence Map

- `src/decision-kernel/v2-pr-lifecycle-action.test.ts` covers the action-taking path for current-head review requests, CI waits, stale review terminal cleanup, operator escalation, merge readiness, disabled mode, and diagnostic-only rollback mode.
- `src/decision-kernel/pr-lifecycle-trace-presenter.test.ts` and `src/decision-kernel/pr-lifecycle-trace-fixtures.test.ts` verify that trace diagnostics expose v2 mode, action source, selected action, safety evidence, and rollback posture.
- `src/decision-kernel/v2-explain.test.ts` verifies that explain output distinguishes no-auto-merge readiness from configured auto-merge readiness.
- `src/supervisor/replay-corpus-runner.test.ts` keeps the checked-in replay corpus covering stale local blocked state recovered by fresh GitHub green, clean, mergeable current-head evidence.

## Rollback Posture

- `disabled`: v2 is already inactive and no v2 PR lifecycle action is selected.
- `diagnostic_only`: v2 renders diagnostics without mutation authority and can be used as the rollback posture after action-taking is disabled.
- `pr_lifecycle_action_taking`: v2 is authoritative for PR lifecycle action selection, but merge still requires explicit passing merge gate evidence before a merge action can be selected.

## Phase 5 Boundary

Phase 5 should focus on operator-action vocabulary and UX integration. Phase 4 does not replace merge execution, issue selection, branch protection, or the supervisor's final auto-merge guard.
