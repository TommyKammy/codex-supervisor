# Issue #1265: [codex] Fix remaining release-blocking timeout summary and agent-runner regressions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1265
- Branch: codex/issue-1265
- Workspace: .
- Journal: .codex-supervisor/issues/1265/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2ec5549a216f7040988ae07dacc2611752b67375
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T12:07:48.965Z

## Latest Codex Summary
- Reproduced a focused timeout-summary regression by adding a command test where stderr is already noisy before the timeout fires. Fixed timeout stderr rendering so both the captured stderr and the shorter error message retain the timeout summary under bounded output. Verified with focused timeout tests and a local build after installing lockfile-pinned dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Pre-timeout noisy stderr could evict the timeout summary from the bounded timeout diagnostics even though post-SIGTERM noisy timeout coverage already passed.
- What changed: Added a focused regression test in `src/core/command.test.ts`, preserved timeout summaries in final bounded stderr at close time, and taught the short error-message formatter to retain timeout lines under truncation.
- Current blocker: none
- Next exact step: Commit the focused timeout-summary fix and leave the branch ready for PR/draft PR handling.
- Verification gap: none for the requested focused tests; `npm run build` passed after `npm ci`.
- Files touched: src/core/command.ts; src/core/command.test.ts
- Rollback concern: Low; changes are limited to timeout error rendering and one focused regression test.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
