# Issue #532: Replay corpus: define a canonical case bundle format and corpus manifest

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/532
- Branch: codex/issue-532
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: afd9ba775bfa9fb646e186b9813afab67c34bb9e
- Blocked reason: none
- Last failure signature: replay-corpus-loader-missing
- Repeated failure signature count: 0
- Updated at: 2026-03-18T16:34:23+09:00

## Latest Codex Summary
- Added a canonical replay corpus manifest and case bundle loader, checked in one example case bundle, and verified the focused replay corpus tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing replay corpus contract can stay narrow by standardizing a manifest-driven `replay-corpus/` layout around the existing supervisor cycle snapshot input and a minimal expected replay result file.
- What changed: added `src/supervisor/replay-corpus.ts` to load `replay-corpus/manifest.json`, enforce canonical `cases/<id>/` bundle paths, require `case.json`, `input/snapshot.json`, and `expected/replay-result.json`, and validate manifest/metadata/snapshot consistency deterministically; added focused coverage in `src/supervisor/replay-corpus.test.ts`; checked in `replay-corpus/cases/review-blocked/` as the initial example bundle.
- Current blocker: none
- Next exact step: commit the replay corpus contract on `codex/issue-532`, push the branch, and open the draft PR with the focused verification results.
- Verification gap: I ran the focused replay corpus tests and `npm run build`, but I did not run the full `npm test` suite because the issue only requires corpus loading/validation coverage and the branch already has a narrower proof.
- Files touched: `.codex-supervisor/issue-journal.md`, `replay-corpus/manifest.json`, `replay-corpus/cases/review-blocked/case.json`, `replay-corpus/cases/review-blocked/input/snapshot.json`, `replay-corpus/cases/review-blocked/expected/replay-result.json`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: relaxing the manifest/case cross-checks would let inconsistent corpus metadata drift away from the replay input snapshot and make future maintained cases nondeterministic to review.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18 (JST): Added `src/supervisor/replay-corpus.test.ts` first; the focused repro failed with `Error: Cannot find module './replay-corpus'`, which established the missing loader surface for the canonical corpus format.
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
