# Issue #1220: [codex] Extract shared tracked PR lifecycle projection for reconciliation and diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1220
- Branch: codex/issue-1220
- Workspace: .
- Journal: .codex-supervisor/issues/1220/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ee277a95bbc788dd955528a642f633350e0a2d75
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T22:57:55.766Z

## Latest Codex Summary
- Added a shared tracked PR lifecycle projection helper, switched reconciliation and diagnostics to use it, and covered blocked/draft_pr/ready_to_merge/failed-suppression projections with focused tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: reconciliation stale-failure recovery and tracked PR diagnostics were rebuilding the same tracked PR lifecycle projection shape independently; extracting that projection should keep behavior unchanged while removing drift risk.
- What changed: added `src/tracked-pr-lifecycle-projection.ts`; refactored `src/recovery-reconciliation.ts` and `src/supervisor/tracked-pr-mismatch.ts` to consume it; added focused helper coverage in `src/tracked-pr-lifecycle-projection.test.ts`.
- Current blocker: none.
- Next exact step: stage the helper/refactor/test changes, create a checkpoint commit on `codex/issue-1220`, and leave build verification noted as blocked by missing local `tsc`.
- Verification gap: `npm run build` cannot run in this workspace because `tsc` is not installed (`sh: 1: tsc: not found`).
- Files touched: `src/tracked-pr-lifecycle-projection.ts`, `src/tracked-pr-lifecycle-projection.test.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/tracked-pr-mismatch.ts`, `.codex-supervisor/issues/1220/issue-journal.md`.
- Rollback concern: low; the refactor centralizes existing projection logic and focused diagnostics/recovery suites stayed green.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
