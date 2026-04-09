# Issue #1365: Refactor: extract pull-request state sync helpers from pull-request-state.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1365
- Branch: codex/issue-1365
- Workspace: .
- Journal: .codex-supervisor/issues/1365/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c03d9890136cfb5df3cc0be1c77208d53c7136d5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T00:00:05.746Z

## Latest Codex Summary
- Added a focused sync-module regression test, reproduced the missing-module failure, extracted PR state sync helpers into `src/pull-request-state-sync.ts`, rewired internal sync consumers, and passed focused tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The sync helpers can move out of `src/pull-request-state.ts` without behavior drift if the old module remains a compatibility barrel for policy exports and sync re-exports.
- What changed: Added `src/pull-request-state-sync.test.ts` to reproduce the missing-module failure, created `src/pull-request-state-sync.ts`, reduced `src/pull-request-state.ts` to exports only, and rewired sync-focused imports in lifecycle/recovery/supervisor code and one readiness test.
- Current blocker: none.
- Next exact step: Stage the extracted sync module changes and create a checkpoint commit on `codex/issue-1365`.
- Verification gap: none for the scoped issue verification; full repo test sweep not run.
- Files touched: `.codex-supervisor/issues/1365/issue-journal.md`, `src/pull-request-state-sync.test.ts`, `src/pull-request-state-sync.ts`, `src/pull-request-state.ts`, `src/tracked-pr-lifecycle-projection.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-lifecycle.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`.
- Rollback concern: low; main risk is downstream code relying on imports from `pull-request-state.ts`, mitigated by keeping sync re-exports there.
- Last focused command: `npm run build`
### Scratchpad
- Reproduced first with `npx tsx --test src/pull-request-state-sync.test.ts` failing on `Cannot find module './pull-request-state-sync'`.
- Keep this section short. The supervisor may compact older notes automatically.
