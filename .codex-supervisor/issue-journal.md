# Issue #532: Replay corpus: define a canonical case bundle format and corpus manifest

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/532
- Branch: codex/issue-532
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 05af724a75810c0088926dd4490e1112522a61de
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851FK7H|PRRT_kwDORgvdZ851FK7U
- Repeated failure signature count: 1
- Updated at: 2026-03-18T08:06:29.068Z

## Latest Codex Summary
Addressed the two remaining PR #538 review threads locally. In [src/supervisor/replay-corpus.ts](src/supervisor/replay-corpus.ts), replay corpus input snapshots are now validated as full replay-ready `SupervisorCycleDecisionSnapshot` objects before the bundle loader returns them, so missing `issue` fields or missing `local`/`github`/`decision` objects fail with deterministic corpus validation errors instead of surfacing later as runtime crashes. In [src/supervisor/replay-corpus.test.ts](src/supervisor/replay-corpus.test.ts), there is a regression proving the loader rejects a snapshot that omits `decision`. In [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), machine-local links were replaced with repo-relative links.

Focused verification passed with `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts` and `npm run build`. The only remaining local artifact is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Sanitized the journal links and tightened replay corpus snapshot validation with focused regression coverage.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts`; `npm run build`
Failure signature: none
Next action: commit the review fixes, push PR #538, and resolve the two remaining CodeRabbit threads if the remote review state still matches

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/538#discussion_r2951581488
- Details:
  - .codex-supervisor/issue-journal.md:21 _⚠️ Potential issue_ | _🟡 Minor_ Fixed locally by converting the checked-in journal summary links to repo-relative paths.
  - src/supervisor/replay-corpus.ts:44 _⚠️ Potential issue_ | _🔴 Critical_ Fixed locally by validating the full replay snapshot shape returned from `loadReplayCorpusInputSnapshot()` instead of only checking `schemaVersion`, `issue.number`, `issue.title`, and `capturedAt`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the replay corpus contract is narrow enough if maintained cases are manifest-driven, each bundle has one metadata file plus one input snapshot and one expected replay result, and load-time validation rejects any cross-file drift immediately.
- What changed: tightened `src/supervisor/replay-corpus.ts` so corpus input snapshots are validated as replay-ready `SupervisorCycleDecisionSnapshot` objects, not just partially checked JSON; added a focused regression in `src/supervisor/replay-corpus.test.ts` for a snapshot missing `decision`; and sanitized checked-in issue-journal links to repo-relative paths.
- Current blocker: none
- Next exact step: commit these review fixes, push `codex/issue-532`, and resolve the two remaining PR #538 review threads if the remote thread IDs still match.
- Verification gap: I ran the focused replay corpus tests and `npm run build`, but I did not run the full `npm test` suite because the issue only requires corpus loading/validation coverage and the branch already has a narrower proof.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: relaxing the manifest/case cross-checks would let inconsistent corpus metadata drift away from the replay input snapshot and make future maintained cases nondeterministic to review.
- Last focused command: `npm run build`
### Scratchpad
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
