# Issue #1155: Run tracked-PR reconciliation before new issue selection and merge actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1155
- Branch: codex/issue-1155
- Workspace: .
- Journal: .codex-supervisor/issues/1155/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 114b482ed45d061a8d29b53de11b10defbb8d2d2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T06:16:19.561Z

## Latest Codex Summary
- Added a focused prelude regression proving tracked `pr_open` reconciliation ran after reservation.
- Moved new-issue reservation to run after tracked-PR reconciliation passes, while keeping non-PR blocked recovery behavior out of the early pass.
- Verified with focused prelude and supervisor orchestration suites.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The prelude still reserved a new runnable issue before refreshing tracked `pr_open` and tracked blocked PR state, which could starve merge-ready tracked PR work.
- What changed: Added a reproducing prelude test, removed the early reservation fast path, narrowed the pre-selection blocked recovery pass to tracked PR records only, forwarded the new option through `Supervisor.startRunOnceCycle`, and updated the higher-level orchestration expectation.
- Current blocker: none
- Next exact step: Review diff, commit the focused checkpoint, and hand back with the targeted verification results.
- Verification gap: Full suite not run; targeted scheduler/orchestration coverage passed. The existing timeout-bookkeeping test still logs a non-fatal execution-metrics chronology warning during the suite.
- Files touched: src/run-once-cycle-prelude.ts; src/recovery-reconciliation.ts; src/supervisor/supervisor.ts; src/run-once-cycle-prelude.test.ts; src/supervisor/supervisor-execution-orchestration.test.ts; .codex-supervisor/issues/1155/issue-journal.md
- Rollback concern: The main risk is accidentally broadening pre-selection blocked recovery again and changing unrelated non-PR issue scheduling.
- Last focused command: npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
