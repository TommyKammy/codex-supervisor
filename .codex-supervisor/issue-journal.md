# Issue #536: Replay corpus: seed provider-wait and review-timing cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/536
- Branch: codex/issue-536
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e7b89c4ebdee74f894087c67f88b587a6c15679a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T09:57:23.330Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest fix is to make replay evaluate timing-sensitive decisions against each snapshot's `capturedAt`, then seed the checked-in corpus with three canonical CodeRabbit timing bundles covering initial grace, fresh-observation settled wait, and ready-for-review after draft skip.
- What changed: tightened `src/supervisor/replay-corpus.test.ts` so the checked-in corpus must include `provider-wait-initial-grace`, `provider-wait-settled-after-observation`, and `review-timing-ready-for-review-after-draft-skip` alongside the existing safety cases, and made the checked-in corpus replay use a config that enables the CodeRabbit wait policy. Added `src/supervisor/supervisor-cycle-replay.test.ts` coverage proving replay must honor `capturedAt` instead of live wall-clock time, then updated `src/supervisor/supervisor-cycle-replay.ts` to stub `Date.now()` to the snapshot capture time during replay. Seeded `replay-corpus/manifest.json` and checked in the three deterministic timing bundles under `replay-corpus/cases/`.
- Current blocker: none
- Next exact step: monitor draft PR #542 for CI and review feedback, then address any follow-up on the seeded timing corpus or replay clock behavior.
- Verification gap: none for the scoped acceptance checks; focused replay corpus, replay clock, provider wait/review-signal, supervisor lifecycle coverage, and `npm run build` all passed locally after running `npm ci` in this worktree.
- Files touched: `replay-corpus/manifest.json`, `replay-corpus/cases/provider-wait-initial-grace/`, `replay-corpus/cases/provider-wait-settled-after-observation/`, `replay-corpus/cases/review-timing-ready-for-review-after-draft-skip/`, `src/supervisor/replay-corpus.test.ts`, `src/supervisor/supervisor-cycle-replay.ts`, `src/supervisor/supervisor-cycle-replay.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the only checked-in deterministic timing replays for initial grace, fresh observation, and ready-for-review draft-skip transitions, and replay would fall back to live wall-clock timing for those cases.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/pull-request-state-provider-wait-policy.test.ts src/pull-request-state-coderabbit-settled-waits.test.ts src/github/github-review-signals.test.ts src/supervisor/supervisor-lifecycle.test.ts && npm run build`
### Scratchpad
- 2026-03-18 (JST): Committed the replay timing corpus work as `638df58` (`Seed replay corpus provider timing cases`), pushed `codex/issue-536`, and opened draft PR #542: `https://github.com/TommyKammy/codex-supervisor/pull/542`.
- 2026-03-18 (JST): Added the narrow failing repro first by requiring three new checked-in timing case ids in `src/supervisor/replay-corpus.test.ts`; the focused failure showed the manifest was missing `provider-wait-initial-grace`, `provider-wait-settled-after-observation`, and `review-timing-ready-for-review-after-draft-skip`.
- 2026-03-18 (JST): Added `src/supervisor/supervisor-cycle-replay.test.ts` coverage proving replay must evaluate timing-sensitive waits against `capturedAt`, implemented that replay clock behavior in `src/supervisor/supervisor-cycle-replay.ts`, seeded the three canonical timing bundles in `replay-corpus/cases/`, and verified with `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/pull-request-state-provider-wait-policy.test.ts src/pull-request-state-coderabbit-settled-waits.test.ts src/github/github-review-signals.test.ts src/supervisor/supervisor-lifecycle.test.ts` plus `npm run build` after `npm ci`.
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
