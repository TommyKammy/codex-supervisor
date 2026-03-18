# Issue #537: Replay corpus: seed retry-budget and escalation cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/537
- Branch: codex/issue-537
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ac6ace3fa19ea90acc04b14ac2085d96c4914542
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T10:47:07.847Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded-failure replay coverage needed both schema support and seeded fixtures because the existing replay snapshot omitted retry/failure counters and only covered the PR lifecycle branch, so retry-budget exhaustion and repeated-signature escalation were invisible to the corpus.
- What changed: expanded the replay snapshot schema and replay logic to carry timeout/verification/failure bookkeeping, stop no-PR replays when selection retry budgets are exhausted, escalate repeated identical PR failure signatures to `failed`, and seeded three deterministic corpus cases for timeout retry progression, exhausted verification retries, and repeated-failure escalation.
- Current blocker: none
- Next exact step: review the diff, commit the replay corpus and snapshot updates, and open or update the branch PR once the checkpoint is pushed.
- Verification gap: `npm run build` initially failed because `tsc` was missing from local `node_modules`; `npm install` fixed the environment and the replay-focused suite, bounded-failure lifecycle suite, and build now pass.
- Files touched: `replay-corpus/manifest.json`, `replay-corpus/cases/timeout-retry-budget-progression/`, `replay-corpus/cases/verification-blocker-retry-exhausted/`, `replay-corpus/cases/repeated-failure-escalates-to-failed/`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`, `src/supervisor/supervisor-cycle-snapshot.ts`, `src/supervisor/supervisor-cycle-snapshot.test.ts`, `src/supervisor/supervisor-cycle-replay.ts`, `src/supervisor/supervisor-cycle-replay.test.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`, `package-lock.json`
- Rollback concern: dropping the snapshot schema or replay changes without removing the new corpus cases will make replay fixtures un-loadable or silently miss retry-budget/escalation regressions again.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18 (UTC): Seeded replay corpus cases `timeout-retry-budget-progression`, `verification-blocker-retry-exhausted`, and `repeated-failure-escalates-to-failed`; expanded replay snapshot validation/runtime to include retry/failure bookkeeping and reran `npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/supervisor/replay-corpus.test.ts`.
- 2026-03-18 (UTC): Fixed `src/supervisor/supervisor-recovery-failure-flows.test.ts` to allow the extra `resolvePullRequestForBranch()` call performed during stale-active reconciliation before the intended post-turn refresh failure, then reran `npx tsx --test src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`.
- 2026-03-18 (UTC): `npm run build` initially failed with `sh: 1: tsc: not found`; ran `npm install` to restore local dev dependencies and `npm run build` then passed.
- 2026-03-18 (UTC): Committed the journal-only review-state fix as `4cf9d14` (`Fix replay journal review state`), pushed `codex/issue-536`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ851Hfko` on PR #542 via `gh api graphql`.
- 2026-03-18 (UTC): Updated the issue journal so the active failure context records the replay review threads as resolved after commit `1e16ad4`; `git diff --check` and a narrowed `markdownlint-cli2` run with MD013/MD022/MD032/MD034 disabled for this generated file passed.
- 2026-03-18 (UTC): Committed the replay review follow-up as `1e16ad4` (`Fix replay timing review follow-ups`), pushed `codex/issue-536`, and resolved CodeRabbit threads `PRRT_kwDORgvdZ851HPh-` and `PRRT_kwDORgvdZ851HPiG` on PR #542 via `gh api graphql`.
- 2026-03-18 (UTC): Addressed PR #542 review follow-up by making `withReplayClock()` throw on invalid `capturedAt`, clearing inherited review/local-review wait fields in the provider-grace replay fixture, and adding a malformed-`capturedAt` regression; `npx tsx --test src/supervisor/supervisor-cycle-replay.test.ts src/supervisor/replay-corpus.test.ts` and `npm run build` passed.
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
