# Issue #537: Replay corpus: seed retry-budget and escalation cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/537
- Branch: codex/issue-537
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: ca56167fab9edb503fea0c91a51260ce426c927d
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851IUGH|PRRT_kwDORgvdZ851IUGJ
- Repeated failure signature count: 1
- Updated at: 2026-03-18T11:23:11.690Z

## Latest Codex Summary
Committed and pushed `ca56167` (`Fix replay corpus review follow-ups`). It fixes the invalid replay-fixture timestamps in the escalation and verification-budget cases, updates the tracked journal text to reflect the live open-PR state, and resolves the three CodeRabbit threads on PR #543.

Local verification passed with the focused replay/lifecycle suites and `npm run build`. On GitHub, `build (ubuntu-latest)` and `build (macos-latest)` are passing, while `CodeRabbit` is pending a fresh review on the new head. The workspace still has the expected local journal update plus the pre-existing untracked `.codex-supervisor/replay/` artifact.

Summary: Pushed review-fix commit `ca56167`, resolved the three CodeRabbit threads, and synced the local issue journal to the new PR head.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/supervisor/replay-corpus.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #543 for the new CodeRabbit pass and any rerun checks on `ca56167`, then merge or address any new feedback.

## Active Failure Context
- Category: review
- Summary: 2 unresolved CodeRabbit review thread(s) remain on the tracked journal snapshot.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/543#discussion_r2952677189
- Details:
  - Thread `PRRT_kwDORgvdZ851IUGH` on `.codex-supervisor/issue-journal.md`: refresh the unresolved-review snapshot so it lists only the two still-open review threads and no addressed entries.
  - Thread `PRRT_kwDORgvdZ851IUGJ` on `.codex-supervisor/issue-journal.md`: remove the stored raw review snippet that reintroduced `MD038`, and keep the journal summary free of lint-hostile prompt text.

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded-failure replay coverage needed both schema support and seeded fixtures because the existing replay snapshot omitted retry/failure counters and only covered the PR lifecycle branch, so retry-budget exhaustion and repeated-signature escalation were invisible to the corpus.
- What changed: expanded the replay snapshot schema and replay logic to carry timeout/verification/failure bookkeeping, stop no-PR replays when selection retry budgets are exhausted, escalate repeated identical PR failure signatures to `failed`, seeded three deterministic corpus cases for timeout retry progression, exhausted verification retries, and repeated-failure escalation, fixed the two review-reported fixture timestamp inconsistencies plus the journal's stale draft-PR wording, and trimmed the journal's active-failure snapshot so it no longer embeds stale raw review prompts.
- Current blocker: none
- Next exact step: verify the journal cleanup with targeted lint/search checks, commit the review-only journal update, push `codex/issue-537`, and resolve the two remaining CodeRabbit threads on PR #543.
- Verification gap: rerun targeted journal lint/search checks after the snapshot cleanup before resolving the PR threads.
- Files touched: `replay-corpus/manifest.json`, `replay-corpus/cases/timeout-retry-budget-progression/`, `replay-corpus/cases/verification-blocker-retry-exhausted/`, `replay-corpus/cases/repeated-failure-escalates-to-failed/`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`, `src/supervisor/supervisor-cycle-snapshot.ts`, `src/supervisor/supervisor-cycle-snapshot.test.ts`, `src/supervisor/supervisor-cycle-replay.ts`, `src/supervisor/supervisor-cycle-replay.test.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`, `package-lock.json`
- Rollback concern: restoring the raw review payloads in the journal would reintroduce stale handoff details and the literal `MD038` example, reopening the same review noise without changing product behavior.
- Last focused command: `gh api graphql -f query='query { repository(owner: "TommyKammy", name: "codex-supervisor") { pullRequest(number: 543) { reviewThreads(first: 100) { nodes { id isResolved isOutdated path comments(first: 5) { nodes { url body author { login } } } } } } } }'`
### Scratchpad
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
- 2026-03-18 (JST): Re-queried PR #543 review threads with `gh api graphql`, confirmed only `PRRT_kwDORgvdZ851IUGH` and `PRRT_kwDORgvdZ851IUGJ` remain open on `.codex-supervisor/issue-journal.md`, and trimmed the journal's active-failure snapshot to remove the raw CodeRabbit prompt bodies that were keeping the stale-context and `MD038` findings alive.
