# Issue #1518: Tracked-PR reconciliation should not spend residual default budget on historical done records

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1518
- Branch: codex/issue-1518
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 536f41bb45d29ca0e95ff03daf75a9ff48cf8737
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T08:17:00.443Z

## Latest Codex Summary
- Added a focused tracked-PR reconciliation regression for mixed recoverable-plus-historical state and tightened the `runOnceCyclePrelude` regression to assert the first-cycle lookup set stops at the recoverable tracked PR records.
- Changed default tracked-PR reconciliation selection so mixed-state passes process only recoverable tracked PR records; historical `done` records are now a fallback only when no recoverable tracked PR records remain.
- Verified with `npx tsx --test src/recovery-tracked-pr-reconciliation.test.ts src/run-once-cycle-prelude.test.ts` and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The default tracked-PR reconciliation pass still burned residual budget on historical `done + pr_number` records after checking the recoverable tracked PR subset because prioritization only reordered the array and did not cap the mixed-state pass to the recoverable bucket.
- What changed: Added `src/recovery-tracked-pr-reconciliation.test.ts` to reproduce the mixed-state leak directly, tightened the prelude regression in `src/run-once-cycle-prelude.test.ts`, and updated `prioritizeTrackedMergedButOpenRecords(...)` in `src/recovery-tracked-pr-reconciliation.ts` so the default mixed-state pass only returns recoverable tracked PR records unless no recoverable records remain.
- Current blocker: none
- Next exact step: Commit the focused regression + fix checkpoint on `codex/issue-1518` and proceed with normal PR/update flow if requested.
- Verification gap: Focused regressions and TypeScript build passed; no broader full-suite run yet.
- Files touched: .codex-supervisor/issue-journal.md; src/recovery-tracked-pr-reconciliation.ts; src/recovery-tracked-pr-reconciliation.test.ts; src/run-once-cycle-prelude.test.ts
- Rollback concern: Low; the behavior change is limited to default mixed-state tracked-PR record selection and preserves historical `done` processing once no recoverable tracked PR records remain.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
