# Issue #1416: Publish sticky tracked-PR status comments for draft and ready-promotion blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1416
- Branch: codex/issue-1416
- Workspace: .
- Journal: .codex-supervisor/issues/1416/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 695431180bca336d8bcf4bac42224ecee67b717e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-11T00:01:02.868Z

## Latest Codex Summary
- Added generic sticky tracked-PR status comment handling so draft-state provider suppression and ready-promotion local blockers share one supervisor-owned comment that updates in place.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The existing implementation only handled host-local ready-promotion blocker comments and never published a sticky tracked-PR status comment for persistent draft-state provider suppression.
- What changed: Added focused reproducing tests for draft suppression and blocker-class transitions, generalized the tracked-PR sticky comment marker to `kind=status`, added stable reason codes plus next-action/automatic-retry guidance, and reused the same sticky comment across draft suppression and ready-promotion blockers.
- Current blocker: none
- Next exact step: Commit the verified implementation checkpoint on `codex/issue-1416`.
- Verification gap: none for the targeted issue scope; requested test suite and `npm run build` both passed locally.
- Files touched: src/post-turn-pull-request.ts; src/post-turn-pull-request.test.ts
- Rollback concern: Existing legacy `kind=host-local-blocker` comments are migrated opportunistically by updating either marker kind in place; removing that compatibility path would strand older sticky comments.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
