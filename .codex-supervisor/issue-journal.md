# Issue #535: Replay corpus: seed PR lifecycle and stale-head safety cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/535
- Branch: codex/issue-535
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bd15c238133c86ecfe38d2924c23377471aefbab
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T09:36:54.093Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest fix is to seed the checked-in replay corpus itself with two more canonical bundles, one for required-check gating and one for stale-head merge prevention, and prove them through a focused checked-in corpus replay test rather than broad replay-framework changes.
- What changed: extended `src/supervisor/replay-corpus.test.ts` so the checked-in corpus must contain `review-blocked`, `required-check-pending`, and `stale-head-prevents-merge`, and added a focused assertion that `runReplayCorpus()` replays those bundled cases without mismatches. Seeded `replay-corpus/manifest.json` with the two new cases, checked in narrow snapshot/expected bundles under `replay-corpus/cases/required-check-pending/` and `replay-corpus/cases/stale-head-prevents-merge/`, and refreshed the older `review-blocked` expected failure signature so it matches the current configured-bot replay behavior.
- Current blocker: none
- Next exact step: review the diff for readability, commit the seeded corpus bundles, and open/update the issue PR once the checkpoint is pushed.
- Verification gap: none for the scoped acceptance checks; focused replay corpus, pull-request-state, supervisor lifecycle coverage, and `npm run build` all passed locally after installing worktree dependencies with `npm ci`.
- Files touched: `replay-corpus/manifest.json`, `replay-corpus/cases/review-blocked/expected/replay-result.json`, `replay-corpus/cases/required-check-pending/`, `replay-corpus/cases/stale-head-prevents-merge/`, `src/supervisor/replay-corpus.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would drop the only checked-in stale-head and required-check safety cases, so replay-corpus regressions in those PR lifecycle decisions would stop failing deterministically.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts src/supervisor/supervisor-lifecycle.test.ts && npm run build`
### Scratchpad
- 2026-03-18 (JST): Added the narrow failing repro first by asserting the checked-in replay corpus must include stale-head and required-check cases plus a clean `runReplayCorpus()` pass; seeded `required-check-pending` and `stale-head-prevents-merge` bundles under `replay-corpus/cases/`, aligned the older `review-blocked` expected signature with current configured-bot replay output, and verified with `npx tsx --test src/supervisor/replay-corpus.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts src/supervisor/supervisor-lifecycle.test.ts` and `npm run build` after `npm ci`.
- 2026-03-18 (JST): Addressed the two remaining PR #538 review threads locally by sanitizing `.codex-supervisor/issue-journal.md` links and validating replay corpus snapshots as full replay-ready objects; `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts` and `npm run build` both passed.
- 2026-03-18 (JST): Implemented `loadReplayCorpus()` in `src/supervisor/replay-corpus.ts` with strict manifest path rules, required bundle files, and consistency checks between `case.json` and `input/snapshot.json`.
- 2026-03-18 (JST): Checked in `replay-corpus/manifest.json` and `replay-corpus/cases/review-blocked/` as the first example bundle; `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts` and `npm run build` passed after installing local npm dependencies and fixing one `expectInteger()` typing error.
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
