# Issue #534: Replay corpus: promote captured replay snapshots into canonical corpus cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/534
- Branch: codex/issue-534
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: baa0c4e6210b01a172acee409dde9c5ca8b1f410
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851GMaA|PRRT_kwDORgvdZ851GMaZ
- Repeated failure signature count: 1
- Updated at: 2026-03-18T09:20:52Z

## Latest Codex Summary
Addressed both remaining PR #540 replay-corpus review findings in [src/supervisor/replay-corpus.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534/src/supervisor/replay-corpus.ts) and [src/supervisor/replay-corpus.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-534/src/supervisor/replay-corpus.test.ts). Promotion now clears `local_review_summary_path` alongside the other machine-specific local paths, and it validates any existing on-disk corpus before writing a new bundle so a broken prior case cannot leave the corpus partially mutated on failure.

The focused promotion regression now starts from a non-null `local_review_summary_path` and asserts the promoted snapshot clears it, and a second regression proves promotion rejects an invalid existing corpus before creating the new case or mutating `manifest.json`. I committed the follow-up as `baa0c4e` (`Fix replay corpus promotion review follow-ups`), pushed `codex/issue-534`, and resolved both CodeRabbit review threads on PR #540 via `gh api graphql`. Local verification passed with `npx tsx --test src/supervisor/replay-corpus.test.ts` and `npm run build`. I left the untracked captured snapshot under `.codex-supervisor/replay/` untouched.

Summary: Fixed and pushed the two replay corpus review follow-ups, then resolved the addressed PR threads
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/replay-corpus.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #540 for any further review or CI follow-up

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `src/supervisor/replay-corpus.ts` can own a narrow promotion flow that loads a captured supervisor replay snapshot, normalizes machine-specific fields, writes a canonical bundle, updates `replay-corpus/manifest.json`, and immediately proves the promoted case replays cleanly.
- What changed: kept the existing promotion flow and tightened the review-follow-up edges in `src/supervisor/replay-corpus.ts` by clearing `local.record.local_review_summary_path` during normalization and validating any existing corpus before the first promotion write. Extended `src/supervisor/replay-corpus.test.ts` so the happy-path promotion case starts from a non-null summary path and added a failure-path regression that proves a broken existing case blocks promotion before any on-disk mutation.
- Current blocker: none
- Next exact step: monitor PR #540 for any further review or CI follow-up and avoid broadening the replay corpus surface unless a new concrete regression appears.
- Verification gap: focused replay corpus promotion coverage and `npm run build` both pass locally after the review fixes; I still have not added a checked-in promoted case under `replay-corpus/cases/` because the issue acceptance is satisfied by the promotion flow plus the focused end-to-end test.
- Files touched: `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this follow-up would reintroduce host-specific local-review paths into canonical corpus bundles and allow promotion to partially mutate the corpus before surfacing a pre-existing bundle validation failure.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus.test.ts && npm run build`
### Scratchpad
- 2026-03-18 (JST): Committed the replay-corpus review follow-ups as `baa0c4e` (`Fix replay corpus promotion review follow-ups`), pushed `codex/issue-534`, and resolved CodeRabbit threads `PRRT_kwDORgvdZ851GMaA` and `PRRT_kwDORgvdZ851GMaZ` on PR #540 via `gh api graphql`.
- 2026-03-18 (JST): Addressed the two remaining PR #540 CodeRabbit replay-corpus findings locally by nulling `local_review_summary_path` during promotion, validating the existing corpus before the first write, and adding focused regressions for both cases; `npx tsx --test src/supervisor/replay-corpus.test.ts` and `npm run build` both passed.
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
