# Issue #1312: [codex] Add an opt-in current-head local review gate for tracked codex PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1312
- Branch: codex/issue-1312
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 53a32820443d9b91d9bfd003130dbad54a28977a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-06T23:10:42.277Z

## Latest Codex Summary
Adjusted the tracked current-head gate in [pull-request-state.ts](src/pull-request-state.ts) so a stale reviewed head stays in `waiting_ci` while checks on the new head are still pending, instead of falling through the stale-head merge blocker. I also hardened coverage in [post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts) by switching the later-cycle regression to the real supervisor lifecycle path, and added a direct policy assertion in [pull-request-state-policy.test.ts](src/pull-request-state-policy.test.ts). The journal handoff in [issue-journal.md](.codex-supervisor/issue-journal.md) is now consistent with the pushed branch state.

Pushed to `origin/codex/issue-1312` at `53a3282`. Verification passed with the focused test suites and `npm run build`. The only remaining local changes are untracked supervisor scratch paths under `.codex-supervisor/`, which I did not touch.

Summary: Fixed the tracked stale-head local-review gate so pending checks keep the PR in `waiting_ci` until a current-head rerun is actually possible, added production-path regression coverage, and synced the issue journal after pushing.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
Next action: Let PR #1313 run on pushed head `53a3282`, then address any new CI or review feedback if it appears.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: when the opt-in tracked current-head gate is enabled, a ready PR whose head advanced during pending CI could still fall into `blocked` before any later-cycle rerun path reopened local review.
- What changed: `inferStateFromPullRequest` now returns `waiting_ci` while a tracked stale-head rerun is still blocked on pending checks, then promotes that same path back to `local_review` once the current head is actually runnable; the later-cycle post-turn regression now uses the real supervisor lifecycle derivation instead of a synthetic `waiting_ci` stub, and the policy suite has a direct pending-checks assertion for the tracked stale-head case.
- Current blocker: none; the stale-head pending-check classification is repaired, committed, pushed, and verified locally.
- Next exact step: wait for PR #1313 CI and review to finish on commit `53a3282`, then address any fresh feedback if it appears.
- Verification gap: none in the targeted regression area; broader full-suite verification was not run beyond the focused tests and `npm run build`.
- Files touched: `src/pull-request-state.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`.
- Rollback concern: low; the new behavior is fully opt-in and defaults to `false`, so existing repos stay on current semantics unless they enable the gate.
- Last focused command:
- Last focused commands: `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
