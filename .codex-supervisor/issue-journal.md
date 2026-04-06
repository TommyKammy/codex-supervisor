# Issue #1312: [codex] Add an opt-in current-head local review gate for tracked codex PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1312
- Branch: codex/issue-1312
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: local_review_fix
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: c523281c139003a90024df04510a9ff015c54b9e
- Blocked reason: none
- Last failure signature: local-review:high:high:3:1:clean
- Repeated failure signature count: 2
- Updated at: 2026-04-06T22:21:13.449Z

## Latest Codex Summary
Draft PR is open at https://github.com/TommyKammy/codex-supervisor/pull/1313 against `main` from `codex/issue-1312`. I repaired the stale-current-head local-review deadlock by routing runnable tracked-gate reruns through `local_review`, added the pending-checks-then-green regression coverage, tightened the status assertion, and re-ran the focused verification plus `npm run build`.

Summary: Repaired the tracked current-head local-review deadlock, added later-cycle rerun coverage, and re-verified the branch locally for PR #1313.
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
Next action: Commit and push the repaired tracked-gate lifecycle update to draft PR #1313, then wait for CI or fresh review feedback.
Failure signature: local-review:high:high:3:1:clean

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: when the opt-in tracked current-head gate is enabled, a ready PR whose head advanced during pending CI could still fall into `blocked` before any later-cycle rerun path reopened local review.
- What changed: `inferStateFromPullRequest` now returns `local_review` for ready tracked PRs once the current-head rerun is actually runnable, preventing the stale-head gate from stranding the PR in `blocked`; added a two-cycle post-turn regression for the pending-to-green sequence; narrowed the new status-model assertion to stable gate-specific tokens.
- Current blocker: none; the stale-head rerun path is repaired locally and verified.
- Next exact step: commit and push this repair to PR #1313, then let CI and review re-evaluate the updated branch.
- Verification gap: none in the targeted regression area; broader full-suite verification was not run beyond the focused tests and `npm run build`.
- Files touched: `src/pull-request-state.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`.
- Rollback concern: low; the new behavior is fully opt-in and defaults to `false`, so existing repos stay on current semantics unless they enable the gate.
- Last focused commands: `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
