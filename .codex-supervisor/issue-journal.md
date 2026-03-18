# Issue #536: Replay corpus: seed provider-wait and review-timing cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/536
- Branch: codex/issue-536
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: 4cf9d14c2744464d6ff511d33629402f5f2c0bf3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-18T10:38:29.000Z

## Latest Codex Summary
Updated [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-536/.codex-supervisor/issue-journal.md#L28) so the stored review snapshot no longer claims unresolved replay findings after commit `1e16ad4` resolved the underlying PR threads. Pushed the journal-only follow-up as commit `4cf9d14` and resolved CodeRabbit thread `PRRT_kwDORgvdZ851Hfko` on PR `#542`.

Verified the journal-only change with `git diff --check` and a narrowed `markdownlint-cli2` run that disabled the journal's pre-existing file-wide MD013/MD022/MD032/MD034 violations while checking the edited block. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Updated the issue journal review snapshot, pushed commit `4cf9d14`, and resolved the remaining CodeRabbit thread on PR #542.
State hint: waiting_ci
Blocked reason: none
Tests: `git diff --check`; `cfg=$(mktemp --suffix=.markdownlint-cli2.jsonc) && printf '{ "config": { "MD013": false, "MD022": false, "MD032": false, "MD034": false } }\n' > "$cfg" && npx markdownlint-cli2 --config "$cfg" .codex-supervisor/issue-journal.md`
Failure signature: none
Next action: Monitor PR #542 for CI completion and any further review follow-up.

## Active Failure Context
- Category: resolved
- Summary: 0 unresolved automated review thread(s) remain for the replay timing changes covered by commit `1e16ad4`.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/542#discussion_r2952398185
- Details:
  - Commit `1e16ad4` resolved the substantive replay findings (`PRRT_kwDORgvdZ851HPh-` and `PRRT_kwDORgvdZ851HPiG`) by rejecting malformed replay `capturedAt` values and clearing inherited wait/local-review fields in the provider-grace fixture.
  - This journal-only follow-up keeps the stored failure snapshot aligned with the resolved PR state so future turns do not treat those threads as still open.

## Codex Working Notes
### Current Handoff
- Hypothesis: no substantive replay review issues remain; the only valid follow-up was to keep the durable journal snapshot aligned with the already-resolved PR review state.
- What changed: rewrote the journal summary and active failure block so they explicitly record that commit `1e16ad4` resolved the replay timing review threads, committed the journal-only follow-up as `4cf9d14`, pushed `codex/issue-536`, and resolved thread `PRRT_kwDORgvdZ851Hfko` on PR #542.
- Current blocker: none
- Next exact step: monitor PR #542 for CI completion and any additional review comments after the journal-only follow-up.
- Verification gap: none for the scoped journal change; `git diff --check` and the narrowed `markdownlint-cli2` run cover the edited content without reformatting the whole generated journal.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this update would leave the durable journal claiming an unresolved replay review state that no longer matches PR #542, which can mislead later supervisor turns.
- Last focused command: `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ851Hfko`
### Scratchpad
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
