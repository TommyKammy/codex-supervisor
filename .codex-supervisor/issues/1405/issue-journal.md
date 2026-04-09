# Issue #1405: Stop repeated tracked PR recovery churn when stale local blockers persist

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1405
- Branch: codex/issue-1405
- Workspace: .
- Journal: .codex-supervisor/issues/1405/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2f99503f9b4081b25c99baf6afaa241225f6c8eb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-09T23:04:37.981Z

## Latest Codex Summary
- Suppressed same-head tracked-PR recovery churn for draft PRs when the local verification blocker is unchanged, integrated the existing remote issue branch attempt, and pushed the combined result to draft PR #1410.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Repeated `tracked_pr_lifecycle_recovered` churn came from reconciling blocked verification records into `draft_pr` on the same head even though the ready-for-review gate was still failing locally.
- What changed: `reconcileRecoverableBlockedIssueStates` now preserves a same-head `blocked` verification state for draft tracked PRs, keeps the existing failure context/signature when nothing meaningfully changed, and skips synthetic recovery churn. Added a recovery regression test and a doctor regression test for explicit ready-promotion guidance.
- Current blocker: None for the issue-local change; the repo-wide `npm test -- src/run-once-cycle-prelude.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` entrypoint still fans out into unrelated baseline failures in `src/supervisor/supervisor-status-rendering*.test.ts`.
- Next exact step: Wait on PR #1410 review or CI feedback; if the repo-native `npm test -- ...` command remains a required gate, split its unrelated baseline failures into separate follow-up work.
- Verification gap: The direct focused `tsx` run passed for the touched recovery/doctor/status/prelude surfaces after rebasing onto the remote issue branch, and `npm run build` passed before the rebase; the post-rebase changes were test-only expectation alignment.
- Files touched: src/recovery-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/doctor.test.ts; .codex-supervisor/issues/1405/issue-journal.md
- Rollback concern: Low; behavior change is scoped to blocked tracked PR reconciliation when the PR is still draft and the same verification blocker persists on the same head.
- Last focused command: gh pr view codex/issue-1405 --json number,url,state,isDraft,title
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
