# Issue #533: Replay corpus: add a corpus runner that asserts normalized replay outcomes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/533
- Branch: codex/issue-533
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 62936f2bc0f6974cc4796df2a36c500327f8a03c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T08:21:19.145Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing piece for issue #533 is a runner layered on top of the manifest loader that replays each canonical case in manifest order, normalizes the replayed decision down to the persisted expected-outcome shape, and formats per-case mismatches deterministically.
- What changed: added `runReplayCorpus()` and `formatReplayCorpusOutcomeMismatch()` to `src/supervisor/replay-corpus.ts`, reusing `replaySupervisorCycleDecisionSnapshot()` to execute every loaded case without live mutation; extended `src/supervisor/replay-corpus.test.ts` with focused coverage for multi-case success and deterministic mismatch reporting; and installed local npm dependencies in this worktree so the focused test/build verification could actually run.
- Current blocker: none
- Next exact step: commit the replay corpus runner changes, then decide whether to expose the runner through the CLI or keep this issue scoped to the internal module/test surface before opening/updating the PR.
- Verification gap: `npx tsx --test src/supervisor/replay-corpus.test.ts` and `npm run build` passed after `npm ci`; I did not run the full `npm test` suite because this issue only requires focused replay corpus coverage and the existing unrelated CLI test path depended on missing workspace-local dependencies before install.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: removing the normalized runner or letting mismatch formatting drift would turn maintained corpus cases back into passive fixtures and make regressions harder to triage consistently.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18 (JST): Added a narrow repro for issue #533 in `src/supervisor/replay-corpus.test.ts`, implemented `runReplayCorpus()` plus deterministic mismatch formatting in `src/supervisor/replay-corpus.ts`, installed local dependencies with `npm ci`, and verified with `npx tsx --test src/supervisor/replay-corpus.test.ts` and `npm run build`.
- 2026-03-18 (JST): Committed `Fix replay corpus review validation gaps`, pushed `codex/issue-532`, and resolved the two remaining CodeRabbit review threads on PR #538 after the focused replay tests and `npm run build` passed.
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
