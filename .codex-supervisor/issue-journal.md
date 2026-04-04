# Issue #1292: [codex] Treat artifact-only stale no-PR branches as already_satisfied_on_main

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1292
- Branch: codex/issue-1292
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a0ff00cf03130a630c6d47f5d3c0a1459b1a3f02
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-03T23:46:03.089Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Failed no-PR reconciliation was already classifying artifact-only divergence as `already_satisfied_on_main`, but the recovery branch still converted that result into a blocked manual-review outcome instead of done-style convergence.
- What changed: Updated `reconcileStaleFailedIssueStates` to map failed no-PR `already_satisfied_on_main` results to `doneResetPatch(...)` and `already_satisfied_on_main` recovery events, while leaving `manual_review_required` fail-closed. Tightened regression tests to expect done-state convergence for artifact-only dirty worktrees, artifact-only commits ahead of `origin/main`, and exact-main matches.
- Current blocker: none
- Next exact step: Commit the verified reconciliation and test changes on `codex/issue-1292`.
- Verification gap: none for the requested focused tests and build; unrelated test fixtures still log known execution-metrics chronology warnings without failing.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: Recovery logs for failed no-PR artifact-only cases now emit done-style `already_satisfied_on_main` reasons instead of blocked `failed_no_pr_already_satisfied` reasons, so any downstream tooling matching the old string would need to tolerate the new outcome.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
