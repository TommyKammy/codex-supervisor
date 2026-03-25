# Issue #960: Stale no-PR branch-state bug: ignore all supervisor-owned worktree artifacts when checking already-landed branches

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/960
- Branch: codex/issue-960
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5df93aa7e23ec9b1c935414cc633b51372a2a8c4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T03:28:36.923Z

## Latest Codex Summary
- Reproduced the stale no-PR branch-state bug with focused regressions covering `.codex-supervisor/pre-merge/assessment-snapshot.json` and `.codex-supervisor/execution-metrics/run-summary.json`, then widened the supervisor-owned artifact filter so those worktree-local files no longer block `already_satisfied_on_main`. Focused stale-branch, reconciliation/orchestration verification, and `npm run build` all passed after installing the missing local dev dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale no-PR branch classification was only ignoring the issue journal and replay artifacts, so worktree-local supervisor outputs under `.codex-supervisor/pre-merge/` and `.codex-supervisor/execution-metrics/` were being treated as meaningful diffs and incorrectly forcing `recoverable`.
- What changed: added focused regressions in `src/supervisor/supervisor-stale-no-pr-branch-state.test.ts` and `src/supervisor/supervisor-execution-orchestration.test.ts`, then updated `src/supervisor/supervisor.ts` so stale no-PR branch-state checks ignore `.codex-supervisor/pre-merge/**` and `.codex-supervisor/execution-metrics/**` alongside the journal and replay artifacts.
- Current blocker: none.
- Next exact step: monitor CI and review feedback on draft PR `#982`, then address any reported failures or review comments.
- Verification gap: none in the requested local scope after rerunning the focused stale-branch, recovery reconciliation, orchestration tests, and build.
- Files touched: `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-stale-no-pr-branch-state.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the production change only broadens stale-branch ignore handling for known supervisor-owned worktree artifact roots.
- Last focused command: `npm run build`
- PR status: draft PR `#982` is open at `https://github.com/TommyKammy/codex-supervisor/pull/982`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
