# Issue #1212: [codex] Converge tracked PR recovery when stale failed local state disagrees with GitHub PR facts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1212
- Branch: codex/issue-1212
- Workspace: .
- Journal: .codex-supervisor/issues/1212/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d854b7d62f525e548c221a5031f514095846e189
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T21:43:23.990Z

## Latest Codex Summary
- Added regression coverage for tracked PR stale-failure recovery converging to persisted non-failed state and aligned explain/status diagnostics. Focused tests and `npm run build` pass in this worktree after installing lockfile dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The reported `latest_recovery` versus persisted `state=failed` drift was already fixed in reconciliation logic; the gap was missing regression coverage for the same-head `failed -> draft_pr` tracked PR recovery and its operator-facing diagnostics.
- What changed: Added a focused reconciliation test for same-head `failed -> draft_pr` recovery, plus explain/status regressions asserting the recovered record stays non-failed and no longer emits stale mismatch or `local_state failed` diagnostics.
- Current blocker: none
- Next exact step: Commit the test-only checkpoint on `codex/issue-1212`.
- Verification gap: none for the scoped regression coverage requested in the issue.
- Files touched: `.codex-supervisor/issues/1212/issue-journal.md`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: Low; changes are test-only plus journal notes.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
