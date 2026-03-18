# Issue #547: Replay corpus artifacts: emit full mismatch details only for failing runs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/547
- Branch: codex/issue-547
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 71fae6ece7979ddc1a2f0e1aafe6d3b862ca30b6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T13:53:34.090Z

## Latest Codex Summary
- Added failure-only replay-corpus mismatch artifact persistence in `src/supervisor/replay-corpus.ts`, wired `src/index.ts` to write or clear `.codex-supervisor/replay/replay-corpus-mismatch-details.json` around each replay-corpus run, and updated `.github/workflows/ci.yml` to upload that artifact only when the Ubuntu replay step fails.
- Added focused regressions in `src/supervisor/replay-corpus.test.ts` for deterministic failure-only artifact emission and cleanup on success, plus `src/ci-workflow.test.ts` coverage for failure-only artifact upload. Focused replay-corpus/CLI/workflow tests and `npm run build` passed locally after restoring dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing scope for #547 was a persistence/upload path, not replay evaluation itself; replay-corpus already had compact mismatch summaries, but it never wrote deterministic full details to disk or exposed a CI upload step gated on failure.
- What changed: added deterministic failure-only replay mismatch artifact formatting/persistence in `src/supervisor/replay-corpus.ts`, called it from the `replay-corpus` CLI path in `src/index.ts`, and added an Ubuntu-only `actions/upload-artifact@v4` step in `.github/workflows/ci.yml` gated by `failure()`.
- Current blocker: none
- Next exact step: commit the failure-only artifact changes, push `codex/issue-547`, and open or update the draft PR so CI can verify the new upload path on an actual mismatch.
- Verification gap: focused replay-corpus/CLI/workflow tests and `npm run build` passed locally; broader full-suite verification has not been run.
- Files touched: `.github/workflows/ci.yml`, `src/ci-workflow.test.ts`, `src/index.ts`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: removing the artifact sync would leave CI with only the compact summary and no deterministic mismatch details for failing replay-corpus runs, making review/debugging on failures materially worse again.
- Last focused command: `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts src/ci-workflow.test.ts && npm run build`
### Scratchpad
- 2026-03-18 (JST): Added narrow failing regressions for failure-only replay mismatch artifacts in `src/supervisor/replay-corpus.test.ts` and failure-gated CI upload in `src/ci-workflow.test.ts`; initial failures were `TypeError: syncReplayCorpusMismatchDetailsArtifact is not a function` and a missing upload-artifact step in `.github/workflows/ci.yml`.
- 2026-03-18 (JST): Implemented deterministic `replay-corpus-mismatch-details.json` formatting/persistence under `.codex-supervisor/replay`, removed stale artifacts on all-pass runs, wired the CLI path to sync that artifact, updated the CI workflow to upload it only on failed Ubuntu replay runs, ran `npm ci` to restore the local TypeScript toolchain, and verified with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts src/ci-workflow.test.ts` plus `npm run build`.
- 2026-03-18 (JST): Added narrow `src/index.test.ts` repro coverage for `replay-corpus` argument parsing plus compact all-pass and mismatch CLI summaries; initial focused failures showed the command was missing and the existing CLI helper wrongly assumed `node_modules/tsx/dist/cli.mjs` existed in the workspace.
- 2026-03-18 (JST): Implemented `replay-corpus` in `src/index.ts`, added compact replay corpus summary/mismatch formatters in `src/supervisor/replay-corpus.ts`, and added formatter tests in `src/supervisor/replay-corpus.test.ts`; `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts` passed.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; ran `npm install` to restore local toolchain, fixed a TypeScript narrowing error in `src/index.ts`, then reran `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts && npm run build` successfully.
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
