# Issue #1415: Add sticky tracked-PR status comment publisher abstraction

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1415
- Branch: codex/issue-1415
- Workspace: .
- Journal: .codex-supervisor/issues/1415/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 98401144e24d6551e0c9fc38210c6538f539ac56
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-10T23:36:07.682Z

## Latest Codex Summary
- Added sticky tracked-PR host-local blocker comment publishing with deterministic marker lookup and GitHub comment updates, plus focused regression tests for restart-safe reuse.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Duplicate tracked-PR blocker comments were caused by a create-only GitHub path plus local dedupe fields that do not survive process restarts.
- What changed: Added `GitHubClient.updateIssueComment()` and REST PATCH support; post-turn tracked-PR blocker publishing now appends a deterministic hidden marker, searches PR conversation comments for an owned match, updates that comment when found, and only creates a new comment when no owned comment exists. Added focused tests for the mutation path and restart-safe update behavior.
- Current blocker: none.
- Next exact step: review the diff, commit the checkpoint, and continue with any follow-on sticky publisher abstraction cleanup if needed.
- Verification gap: none for the scoped issue verification; broader full-suite coverage not run this turn.
- Files touched: src/github/github.ts; src/github/github-mutations.ts; src/github/github.test.ts; src/post-turn-pull-request.ts; src/post-turn-pull-request.test.ts
- Rollback concern: The marker format now defines ownership for tracked PR host-local blocker comments; changing it later would strand older sticky comments unless migration or fallback matching is added.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
