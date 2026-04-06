# Issue #1312: [codex] Add an opt-in current-head local review gate for tracked codex PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1312
- Branch: codex/issue-1312
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: local_review_fix
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 9e5f5a403b35e63d5d0ed37f08d5e501c655d8cc
- Blocked reason: none
- Last failure signature: local-review:high:high:2:1:clean
- Repeated failure signature count: 2
- Updated at: 2026-04-06T22:40:40Z

## Latest Codex Summary
Adjusted [src/pull-request-state.ts](src/pull-request-state.ts) so a tracked PR with a stale `local_review_head_sha` stays in `waiting_ci` while checks for the new head are still pending, instead of falling into the stale-head `blocked` path before the rerun can start. I also switched the later-cycle regression in [src/post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts) to use the real supervisor lifecycle derivation and added a direct pending-checks policy assertion in [src/pull-request-state-policy.test.ts](src/pull-request-state-policy.test.ts).

Verification passed: `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`.

Summary: Fixed the stale tracked-head pending-check classification so current-head local review waits for CI before rerunning, and hardened the regression coverage around the real lifecycle path.
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
Next action: Publish the verified repair to PR #1313 and let CI and review re-evaluate the updated branch.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: when the opt-in tracked current-head gate is enabled, a ready PR whose head advanced during pending CI could still fall into `blocked` before any later-cycle rerun path reopened local review.
- What changed: `inferStateFromPullRequest` now returns `waiting_ci` while a tracked stale-head rerun is still blocked on pending checks, then promotes that same path back to `local_review` once the current head is actually runnable; the later-cycle post-turn regression now uses the real supervisor lifecycle derivation instead of a synthetic `waiting_ci` stub, and the policy suite has a direct pending-checks assertion for the tracked stale-head case.
- Current blocker: none; the stale-head pending-check classification is repaired locally and verified.
- Next exact step: verify PR #1313 reflects the latest branch head, then let CI and review re-evaluate the updated branch or address any new feedback.
- Verification gap: none in the targeted regression area; broader full-suite verification was not run beyond the focused tests and `npm run build`.
- Files touched: `src/pull-request-state.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`.
- Rollback concern: low; the new behavior is fully opt-in and defaults to `false`, so existing repos stay on current semantics unless they enable the gate.
- Last focused command:
- Last focused commands: `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
