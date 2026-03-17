# Issue #463: Test refactor: split supervisor diagnostics and recovery coverage out of supervisor.test.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/463
- Branch: codex/issue-463
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-463
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-463/.codex-supervisor/issue-journal.md
- Current phase: local_review
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3d5bf9a0dc52b8c4bb5e8832962ee96d3fa2fd50
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T09:35:15Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `supervisor.test.ts` shrinks safely if diagnostics (`doctor`/`status`/`explain`) and explicit reconciliation-recovery cases move into dedicated suites backed by a small supervisor-only fixture helper.
- What changed: Added `src/supervisor/supervisor-test-helpers.ts`, extracted diagnostics coverage to `src/supervisor/supervisor-diagnostics.test.ts`, extracted reconciliation/recovery coverage to `src/supervisor/supervisor-recovery.test.ts`, and removed those cases from `src/supervisor/supervisor.test.ts`.
- Current blocker: none
- Next exact step: Review the final diff, then commit the issue-463 refactor checkpoint on `codex/issue-463`.
- Verification gap: none; the focused diagnostics/recovery suites, the remaining `supervisor.test.ts`, and `npm run build` all pass locally.
- Files touched: src/supervisor/supervisor.test.ts; src/supervisor/supervisor-diagnostics.test.ts; src/supervisor/supervisor-recovery.test.ts; src/supervisor/supervisor-test-helpers.ts; .codex-supervisor/issue-journal.md
- Rollback concern: Keep `supervisor-test-helpers.ts` limited to shared fixture setup for supervisor integration tests; if unrelated suites start depending on it, the ownership boundary this split created will blur again.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: `src/supervisor/supervisor.test.ts` was a single 4851-line suite mixing diagnostics, reconciliation/recovery, and heavier execution-path coverage.
- File size after extraction: `src/supervisor/supervisor.test.ts` is now 2670 lines; extracted suites are 1113 lines (`supervisor-diagnostics.test.ts`) and 813 lines (`supervisor-recovery.test.ts`).
- Verification commands: `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery.test.ts`; `npx tsx --test src/supervisor/supervisor.test.ts`; `npm ci`; `npm run build`.
- Local failure resolved: `npm run build` initially failed with `sh: 1: tsc: not found` because `node_modules` was absent in this worktree; `npm ci` restored the local toolchain.
