# Issue #1365: Refactor: extract pull-request state sync helpers from pull-request-state.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1365
- Branch: codex/issue-1365
- Workspace: .
- Journal: .codex-supervisor/issues/1365/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: dda9072dbc4026c85e3e8601e222053baf1d2fac
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T00:07:10Z

## Latest Codex Summary
Summary: Pushed `codex/issue-1365` at `dda9072`, opened draft PR #1372 for the pull-request sync helper extraction, and refreshed the issue journal for the next supervisor pass.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-sync.test.ts`; `npx tsx --test src/pull-request-state-policy.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts`; `npm run build`
Next action: Monitor draft PR #1372 (`https://github.com/TommyKammy/codex-supervisor/pull/1372`) for CI or review feedback and keep the supervisor runtime artifacts out of scope.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The sync helpers can move out of `src/pull-request-state.ts` without behavior drift if the old module remains a compatibility barrel for policy exports and sync re-exports.
- What changed: Added `src/pull-request-state-sync.test.ts` to reproduce the missing-module failure, created `src/pull-request-state-sync.ts`, reduced `src/pull-request-state.ts` to exports only, rewired sync-focused imports in lifecycle/recovery/supervisor code and one readiness test, pushed branch `codex/issue-1365`, and opened draft PR #1372.
- Current blocker: none.
- Next exact step: Watch draft PR #1372 for CI results or review feedback and respond if either appears.
- Verification gap: none for the scoped issue verification; full repo test sweep not run.
- Files touched: `.codex-supervisor/issues/1365/issue-journal.md`, `src/pull-request-state-sync.test.ts`, `src/pull-request-state-sync.ts`, `src/pull-request-state.ts`, `src/tracked-pr-lifecycle-projection.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-lifecycle.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`.
- Rollback concern: low; main risk is downstream code relying on imports from `pull-request-state.ts`, mitigated by keeping sync re-exports there.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1365 --title '[codex] Extract pull-request state sync helpers' --body-file /tmp/tmp.J1Tv0jKocs`
### Scratchpad
- Reproduced first with `npx tsx --test src/pull-request-state-sync.test.ts` failing on `Cannot find module './pull-request-state-sync'`.
- Keep this section short. The supervisor may compact older notes automatically.
