# Issue #528: Supervisor bug: issue can stay locked in stabilizing with wrong PR context and no active Codex turn

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/528
- Branch: codex/issue-528
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: cc79a0a7cbd8f182d72f4909f1165af4a89c8031
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T06:07:13.358Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the stabilizing recovery bug comes from two invariant breaks: stale-lock cleanup leaves a stranded `stabilizing` record half-active unless it already has `pr_number=null`, and PR rediscovery/reconciliation accepts a tracked PR number even when that PR belongs to a different issue branch.
- What changed: added focused regressions in `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, and `src/github/github.test.ts`; changed stale active reservation cleanup to auth-check first and then requeue `stabilizing` records when no matching branch PR exists; enforced branch matching in `resolvePullRequestForBranch()` and tracked-merged reconciliation; and cleared stale `pr_number` during issue preparation when branch PR resolution returns null.
- Current blocker: none
- Next exact step: commit the recovery fix on `codex/issue-528`, then open or update the draft PR with the focused verification results.
- Verification gap: `npx tsx --test ...` and `npm run build` passed, but I did not rerun the repo-wide `npm test` script because it expands to the full suite and still includes unrelated pre-existing failures in layout/prompt tests outside this issue.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/github/github.test.ts`, `src/github/github.ts`, `src/recovery-reconciliation.ts`, `src/run-once-cycle-prelude.ts`, `src/run-once-issue-preparation.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting the branch-matching guards would allow stale `pr_number` state from another issue branch to mark the current issue done or keep it stuck in `stabilizing` again.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18 (JST): Added a narrow repro in `src/supervisor/supervisor-recovery-reconciliation.test.ts` showing `reconcileStaleActiveIssueReservation()` left stale `stabilizing` records in place instead of requeueing when the reservation locks were gone and no PR was tracked.
- 2026-03-18 (JST): Added a supervisor dry-run regression in `src/supervisor/supervisor-execution-orchestration.test.ts` showing a stale `stabilizing` record with `pr_number=527` from another issue branch could be reclaimed with wrong PR context unless recovery cleared it first.
- 2026-03-18 (JST): Added `src/github/github.test.ts` coverage proving `resolvePullRequestForBranch()` must ignore tracked PRs whose `headRefName` does not match the issue branch.
- 2026-03-18 (JST): Implemented branch-matching guards in `src/github/github.ts` and `src/recovery-reconciliation.ts`, moved auth handling ahead of stale-lock cleanup in `src/run-once-cycle-prelude.ts`, and cleared stale `pr_number` state in `src/run-once-issue-preparation.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`, `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`, `npx tsx --test src/github/github.test.ts`, and `npm run build` passed.
- 2026-03-18 (JST): Added two narrow repro tests in `src/local-review/execution.test.ts`; initial focused failure was `TypeError: (0 , import_test_helpers.createRoleTurnOutput) is not a function`.
- 2026-03-18 (JST): Implemented `createFakeLocalReviewRunner()`, `createRoleTurnOutput()`, and `createVerifierTurnOutput()` in `src/local-review/test-helpers.ts`; first pass exposed a shape mismatch (`Cannot read properties of undefined (reading 'match')`) because the helper accepted raw strings but did not normalize them into `{ exitCode, rawOutput }`.
- 2026-03-18 (JST): Normalized string outputs inside the fake runner helper; `npx tsx --test src/local-review/execution.test.ts`, `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts`, and `npm run build` then passed.
- 2026-03-18 (JST): Resumed in stabilizing; confirmed HEAD `6d6d7fa`, no PR existed yet for `codex/issue-525`, and prepared the handoff for the push/PR step.
- 2026-03-18 (JST): Pushed `codex/issue-525` to origin and opened draft PR #529: `https://github.com/TommyKammy/codex-supervisor/pull/529`.
- 2026-03-18 (JST): Addressed the two CodeRabbit review findings by switching the fake runner to a `hasOwnProperty` lookup so `""` remains a valid configured `rawOutput`, sanitizing the journal's stored review snippet to repo-relative links, and adding a regression test; `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts` and `npm run build` passed.
- 2026-03-18 (JST): Committed the review follow-ups as `c36827e` (`Fix fake local-review runner review follow-ups`), pushed `codex/issue-525`, and resolved both CodeRabbit review threads via `gh api graphql`.
