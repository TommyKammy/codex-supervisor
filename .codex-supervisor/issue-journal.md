# Issue #1614: Respect timeout retry budget in failed no-PR transient auto-requeue

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1614
- Branch: codex/issue-1614
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0b9daef8d8590529bee4dfc162ab65f430a52f1e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-21T08:22:50.897Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Failed no-PR `already_satisfied_on_main` transient auto-requeue was treating timeout runtime evidence as always allowlisted, so exhausted timeout budgets still received one extra retry outside `shouldAutoRetryTimeout()`.
- What changed: Added an exhausted-timeout regression test and tightened the no-PR transient runtime classifier so `timeout` only stays allowlisted when the timeout retry budget still permits another retry; non-timeout `provider-capacity` behavior remains one-shot.
- Current blocker: none
- Next exact step: Stage only the issue journal and source/test changes, then create a checkpoint commit on `codex/issue-1614`.
- Verification gap: none for the issue scope; requested reconciliation/diagnostic tests and `npm run build` passed locally.
- Files touched: .codex-supervisor/issue-journal.md; src/recovery-no-pr-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts
- Rollback concern: Low; the change only narrows timeout-based no-PR auto-requeue eligibility to the existing canonical timeout retry policy.
- Last focused command: npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
