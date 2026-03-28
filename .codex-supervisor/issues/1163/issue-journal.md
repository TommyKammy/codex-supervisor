# Issue #1163: Fail closed for parent-epic auto-close in degraded inventory mode unless the child set is known complete

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1163
- Branch: codex/issue-1163
- Workspace: .
- Journal: .codex-supervisor/issues/1163/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 36418cb962b73b2c87355b62b8f4749472eca30b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T11:39:24.009Z

## Latest Codex Summary
- Reproduced the degraded parent-epic auto-close bug with a focused `runOnceCyclePrelude` regression where malformed full inventory plus one closed tracked child still invoked parent closure reconciliation.
- Fixed the degraded path to fail closed by skipping parent-epic closure reconciliation when full inventory refresh is unavailable, leaving healthy full-inventory closure behavior unchanged.
- Verified with focused prelude, issue-metadata, recovery-reconciliation, and malformed-inventory regression suites.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Premature parent-epic auto-close came from degraded prelude fallback passing tracked issue snapshots into parent closure reconciliation without any proof that the visible child set was complete.
- What changed: Removed degraded parent-epic closure fallback from `runOnceCyclePrelude` and replaced the old degraded-closure expectations with fail-closed regression coverage, including a focused `#1150`/`#1152`-style partial-child test.
- Current blocker: none
- Next exact step: Commit the focused fail-closed fix on `codex/issue-1163`; open/update a draft PR if requested by the supervisor flow next.
- Verification gap: `npm run test:malformed-inventory-regressions` relies on `tsx` being on PATH in this shell, so the equivalent suite was run directly with `npx tsx --test ...`.
- Files touched: `.codex-supervisor/issues/1163/issue-journal.md`, `src/run-once-cycle-prelude.ts`, `src/run-once-cycle-prelude.test.ts`
- Rollback concern: This intentionally disables degraded parent-epic auto-close entirely until a future path can prove the child set is complete.
- Last focused command: `npx tsx --test src/github/github.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
