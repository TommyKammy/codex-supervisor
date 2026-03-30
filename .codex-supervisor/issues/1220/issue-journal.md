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
- Added a shared tracked PR lifecycle projection helper, switched reconciliation and diagnostics to use it, covered blocked/draft_pr/ready_to_merge/failed-suppression projections with focused tests, committed the change, and opened draft PR #1223.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: reconciliation stale-failure recovery and tracked PR diagnostics were rebuilding the same tracked PR lifecycle projection shape independently; extracting that projection should keep behavior unchanged while removing drift risk.
- What changed: added `src/tracked-pr-lifecycle-projection.ts`; refactored `src/recovery-reconciliation.ts` and `src/supervisor/tracked-pr-mismatch.ts` to consume it; added focused helper coverage in `src/tracked-pr-lifecycle-projection.test.ts`; committed as `7902700` (`Extract tracked PR lifecycle projection`) and opened draft PR `#1223`.
- Current blocker: none.
- Next exact step: let CI validate the draft PR and, if a full build is still needed locally, restore/install the missing TypeScript toolchain so `npm run build` can run.
- Verification gap: `npm run build` cannot run in this workspace because `tsc` is not installed (`sh: 1: tsc: not found`).
- Files touched: `src/tracked-pr-lifecycle-projection.ts`, `src/tracked-pr-lifecycle-projection.test.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/tracked-pr-mismatch.ts`, `.codex-supervisor/issues/1220/issue-journal.md`.
- Rollback concern: low; the refactor centralizes existing projection logic and focused diagnostics/recovery suites stayed green.
- Last focused command: `gh pr create --repo TommyKammy/codex-supervisor --base main --head codex/issue-1220 --draft --title "[codex] Extract shared tracked PR lifecycle projection for reconciliation and diagnostics" --body-file "$tmpfile"`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
