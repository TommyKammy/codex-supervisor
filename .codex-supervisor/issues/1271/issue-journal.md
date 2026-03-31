# Issue #1271: [codex] Comment on tracked PRs when host-local CI gates block progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1271
- Branch: codex/issue-1271
- Workspace: .
- Journal: .codex-supervisor/issues/1271/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 45af90a5c827348c6f46274c42fd13aa079fe0ba
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T22:39:19.705Z

## Latest Codex Summary
Implemented tracked-PR host-local blocker comments in [src/post-turn-pull-request.ts](src/post-turn-pull-request.ts), with best-effort posting, durable dedupe by PR head plus blocker signature, and a new GitHub `issue comment` client method in [src/github/github.ts](src/github/github.ts). I also added focused coverage in [src/post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts) and persisted the dedupe fields through [src/core/types.ts](src/core/types.ts), [src/core/state-store.ts](src/core/state-store.ts), and [src/turn-execution-test-helpers.ts](src/turn-execution-test-helpers.ts).

Verification passed after hydrating the locked dev dependencies with `npm ci` because this worktree initially lacked `tsc`. I also updated the issue journal and checkpointed the work on commit `45af90a` (`Comment on tracked PR host-local blockers`).

Summary: Added best-effort tracked PR blocker comments for host-local workspace preparation/local CI failures, with dedupe by head plus blocker signature, focused tests, and a checkpoint commit.
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/turn-execution-publication-gate.test.ts`; `npx tsx --test src/doctor.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts src/doctor.test.ts`; `npm run build`
Next action: Open or update the draft PR for `codex/issue-1271` so the new tracked-PR blocker comment behavior can go through review.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Tracked draft PRs were already transitioning to `blocked` on host-local workspace-preparation and local-CI gates, but no PR conversation comment was emitted from that post-turn path.
- What changed: Added best-effort tracked-PR blocker commenting in the draft-to-ready gate for workspace preparation and local CI failures, persisted dedupe markers by PR head plus blocker signature, added a GitHub `issue comment` client method, and covered comment emission, dedupe, and comment-failure behavior with focused tests.
- Current blocker: none
- Next exact step: Push `codex/issue-1271` to `github` and open a draft PR against `main` with the verified checkpoint.
- Verification gap: none for the requested local scope after `npm ci`; requested targeted tests and `npm run build` passed.
- Files touched: src/post-turn-pull-request.ts; src/post-turn-pull-request.test.ts; src/github/github.ts; src/core/types.ts; src/core/state-store.ts; src/turn-execution-test-helpers.ts
- Rollback concern: Low; the new PR comment path is best-effort and only persists dedupe markers after a successful comment, so reverting is isolated to tracked draft-PR blocker notification behavior.
- Last focused command: gh repo view --json nameWithOwner,defaultBranchRef
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
