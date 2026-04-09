# Issue #1394: Refactor: extract post-turn pull-request scenario builders from tests

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1394
- Branch: codex/issue-1394
- Workspace: .
- Journal: .codex-supervisor/issues/1394/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d3f626922e7df0ce596ddac57d320ce9fdb60aa0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T08:55:45.910Z

## Latest Codex Summary
- Extracted reusable post-turn PR test builders for tracked PR fixtures, shared context/github wiring, lifecycle snapshots, and local-review result construction in `src/post-turn-pull-request.test.ts`. Focused post-turn PR tests and `npm run build` now pass.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The issue is a test-only refactor; extracting common tracked-PR and local-review builders should reduce repetition without changing assertions or behavior coverage.
- What changed: Added shared helpers near the top of `src/post-turn-pull-request.test.ts` and rewired the follow-up, same-PR repair, manual-review gate, and degraded advisory draft scenarios to use them.
- Current blocker: none
- Next exact step: Commit the refactor checkpoint on `codex/issue-1394`.
- Verification gap: No broader full-suite run beyond the issue-scoped focused tests and `npm run build`.
- Files touched: `src/post-turn-pull-request.test.ts`; `.codex-supervisor/issues/1394/issue-journal.md`
- Rollback concern: Low; change is isolated to test helpers and test fixture setup.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
