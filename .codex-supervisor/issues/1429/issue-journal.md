# Issue #1429: Separate stale configured-bot review blockers from generic manual_review

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1429
- Branch: codex/issue-1429
- Workspace: .
- Journal: .codex-supervisor/issues/1429/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: d2efa966dcf7ed287e44ffa6551107e421789ec6
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-04-11T07:59:31.847Z

## Latest Codex Summary
Implemented the issue on `codex/issue-1429` and pushed it.

The change introduces a dedicated `stale_review_bot` blocked reason for the narrow stale configured-bot path: all remaining unresolved threads are from configured bot reviewers, they were already processed on the current head, no same-head follow-up remains, and the PR is otherwise on a clean lane. Mixed human+bot review and other conservative blockers still stay on `manual_review`. I added focused coverage in the three requested test files, updated downstream blocked-reason validators, and kept repeated tracked-PR failure escalation from collapsing the new reason back to `manual_review`.

Draft PR: [#1434](https://github.com/TommyKammy/codex-supervisor/pull/1434)  
Commits: `f0eae38`, `d2efa96`

Summary: Added `stale_review_bot` classification for stale configured-bot review blockers, verified focused tests and build, and opened draft PR #1434.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-policy.test.ts src/review-thread-reporting.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`; `npm run build`
Next action: Wait for CI and draft PR review on #1434, then address any follow-up failures if they appear.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1434 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1434
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/24278112644/job/70895409882

## Codex Working Notes
### Current Handoff
- Hypothesis: The implementation was correct, but the replay corpus expectation for `review-blocked` issue `#532` still encoded the old `manual_review` blocker and caused CI to fail on `npx tsx src/index.ts replay-corpus`.
- What changed: Confirmed the GitHub Actions failure from run `24278112644` locally, reproduced `Replay corpus summary: total=9 passed=8 failed=1`, and updated `replay-corpus/cases/review-blocked/expected/replay-result.json` so the expected blocker reason is `stale_review_bot`.
- Current blocker: none
- Next exact step: Commit the replay-corpus expectation repair, push `codex/issue-1429`, and wait for PR #1434 CI to rerun.
- Verification gap: Full repo test suite not run; focused issue verification, replay corpus, and `npm run build` are green.
- Files touched: src/core/types.ts; src/review-thread-reporting.ts; src/pull-request-state-policy.ts; src/supervisor/supervisor.ts; src/codex/codex-output-parser.ts; src/supervisor/execution-metrics-schema.ts; src/supervisor/replay-corpus-validation.ts; src/pull-request-state-policy.test.ts; src/review-thread-reporting.test.ts; src/supervisor/supervisor-pr-review-blockers.test.ts; replay-corpus/cases/review-blocked/expected/replay-result.json
- Rollback concern: `stale_review_bot` is a new persisted reason code, so any downstream logic that intentionally special-cases only `manual_review` may need explicit expansion if future behavior should treat stale bot blockers identically.
- Last focused commands: `python3 .../inspect_pr_checks.py --repo . --pr 1434 --json`; `npx tsx src/index.ts replay-corpus`; `npx tsx --test src/pull-request-state-policy.test.ts src/review-thread-reporting.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
