# Issue #534: Replay corpus: promote captured replay snapshots into canonical corpus cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/534
- Branch: codex/issue-534
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 87ca4ee5b6dbbae4e8fb45bc2f47bc7d3ab6f5d7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T08:59:03.961Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `src/supervisor/replay-corpus.ts` can own a narrow promotion flow that loads a captured supervisor replay snapshot, normalizes machine-specific fields, writes a canonical bundle, updates `replay-corpus/manifest.json`, and immediately proves the promoted case replays cleanly.
- What changed: added `promoteCapturedReplaySnapshot()` to `src/supervisor/replay-corpus.ts`, including manifest creation/loading, case-id validation, normalization of `local.record.workspace`, `local.record.journal_path`, and `local.workspaceStatus.hasUncommittedChanges`, expected-outcome generation from the normalized replay result, and post-write corpus validation. Added a focused end-to-end regression in `src/supervisor/replay-corpus.test.ts` covering promotion of a representative no-PR captured snapshot into a valid canonical bundle.
- Current blocker: none
- Next exact step: review the diff, commit the replay corpus promotion implementation, and open or update the draft PR for `codex/issue-534`.
- Verification gap: focused replay corpus promotion coverage and `npm run build` both pass locally; I have not added a checked-in promoted case under `replay-corpus/cases/` yet because the issue acceptance is satisfied by the promotion flow plus the focused end-to-end test.
- Files touched: `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this change would remove the only supported path for turning captured snapshots into canonical replay corpus bundles and would reopen the focused regression around volatile workspace fields.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus.test.ts && npm run build`
### Scratchpad
- 2026-03-18 (JST): Added `promoteCapturedReplaySnapshot()` in `src/supervisor/replay-corpus.ts` and a focused end-to-end promotion regression in `src/supervisor/replay-corpus.test.ts`; after installing local npm dependencies with `npm ci`, `npx tsx --test src/supervisor/replay-corpus.test.ts` and `npm run build` both passed.
- 2026-03-18 (JST): Addressed the remaining PR #539 CodeRabbit journal-link thread locally by converting `.codex-supervisor/issue-journal.md` to repo-relative replay-corpus links and verifying the file no longer contains absolute workspace-path or file-URI references with `rg`.
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
