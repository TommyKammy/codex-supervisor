# Issue #1151: Expose GitHub-versus-local tracked PR mismatches in doctor status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1151
- Branch: codex/issue-1151
- Workspace: .
- Journal: .codex-supervisor/issues/1151/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 114b482ed45d061a8d29b53de11b10defbb8d2d2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T06:38:52.871Z

## Latest Codex Summary
- Added non-mutating tracked PR mismatch diagnostics so `doctor`, `status`, and `explain` explicitly show when GitHub lifecycle facts say a tracked PR is ready while local state is still blocked/failed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Operator diagnostics need a shared tracked-PR comparison against live GitHub PR lifecycle facts, not just persisted local state, to expose stale `blocked`/`failed` records.
- What changed: Added `src/supervisor/tracked-pr-mismatch.ts`; wired mismatch summaries and guidance into `status`, `doctor`, and `explain`; added focused regression tests for all three surfaces.
- Current blocker: None.
- Next exact step: Review the diff, commit the checkpoint, and optionally widen coverage if another operator-facing surface also needs the same mismatch summary.
- Verification gap: `npm run build` could not use `tsc` because TypeScript is not installed in this workspace PATH/node_modules; focused tsx tests passed.
- Files touched: src/supervisor/tracked-pr-mismatch.ts; src/supervisor/supervisor.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/doctor.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/doctor.test.ts
- Rollback concern: Low; the change is additive diagnostics-only logic that does not mutate tracked state.
- Last focused command: npx tsx --test src/doctor.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
