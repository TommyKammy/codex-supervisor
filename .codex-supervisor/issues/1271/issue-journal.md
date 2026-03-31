# Issue #1271: [codex] Comment on tracked PRs when host-local CI gates block progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1271
- Branch: codex/issue-1271
- Workspace: .
- Journal: .codex-supervisor/issues/1271/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f42d5a5bd0f486e28fdd51d525602ea9b130f67e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T22:28:34.842Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Tracked draft PRs were already transitioning to `blocked` on host-local workspace-preparation and local-CI gates, but no PR conversation comment was emitted from that post-turn path.
- What changed: Added best-effort tracked-PR blocker commenting in the draft-to-ready gate for workspace preparation and local CI failures, persisted dedupe markers by PR head plus blocker signature, added a GitHub `issue comment` client method, and covered comment emission, dedupe, and comment-failure behavior with focused tests.
- Current blocker: none
- Next exact step: Commit the verified checkpoint on `codex/issue-1271` and leave the branch ready for PR/open-review flow.
- Verification gap: none for the requested local scope after `npm ci`; requested targeted tests and `npm run build` passed.
- Files touched: src/post-turn-pull-request.ts; src/post-turn-pull-request.test.ts; src/github/github.ts; src/core/types.ts; src/core/state-store.ts; src/turn-execution-test-helpers.ts
- Rollback concern: Low; the new PR comment path is best-effort and only persists dedupe markers after a successful comment, so reverting is isolated to tracked draft-PR blocker notification behavior.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
