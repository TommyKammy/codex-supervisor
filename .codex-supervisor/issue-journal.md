# Issue #1460: Stale no-PR recovery reruns Codex instead of resuming draft PR publication for clean checkpoint branches

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1460
- Branch: codex/issue-1460
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 09bd0ffea7244279e88951a840200e24f9e14ade
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-12T10:44:45.661Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale no-PR recovery was rerunning Codex because supervisor-owned issue-journal dirtiness prevented clean checkpoint branches from inferring `draft_pr`, and dry-run still tried to execute the publication path as a Codex turn.
- What changed: ignored supervisor-owned issue-journal paths when computing workspace dirtiness, taught dry-run checkpoint hydration to stop before mutating GitHub, and added regression coverage for stale no-PR dry-run publication plus the shared lifecycle/preparation helpers.
- Current blocker: none.
- Next exact step: commit the verified fix, then let the supervisor move this issue to the next publication/review phase.
- Verification gap: full requested file suites and build passed locally; no broader full-suite run beyond the touched file-level regressions.
- Files touched: .codex-supervisor/issue-journal.md; src/core/git-workspace-helpers.ts; src/core/git-workspace-helpers.test.ts; src/core/workspace.ts; src/run-once-issue-preparation.ts; src/run-once-issue-preparation.test.ts; src/supervisor/supervisor-lifecycle.ts; src/supervisor/supervisor-lifecycle.test.ts; src/supervisor/supervisor-execution-orchestration.test.ts
- Rollback concern: if supervisor-owned journal paths should ever count as meaningful dirtiness for publication gating, this change would make those worktrees look clean again.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
