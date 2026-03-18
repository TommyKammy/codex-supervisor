# Issue #545: Replay corpus UX: add a compact CLI summary with normalized mismatch output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/545
- Branch: codex/issue-545
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 663ebbe26cc1d14089840874b19bbad09b4a3f3c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T12:49:29.000Z

## Latest Codex Summary
- Added a dedicated `replay-corpus` CLI entry path with a compact summary line and one deterministic normalized mismatch line per failing case, kept `runReplayCorpus()` semantics unchanged, added focused CLI and formatter tests, installed missing local dependencies, and verified `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts` plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the replay corpus runner already returns normalized outcomes, so the narrow missing UX is a CLI wrapper that summarizes pass/fail counts and renders one compact deterministic normalized mismatch line per failed case.
- What changed: added `replay-corpus` parsing and CLI execution in `src/index.ts`, defaulted the command to the checked-in `replay-corpus` path when no argument is provided, added compact summary/mismatch formatters in `src/supervisor/replay-corpus.ts`, added focused CLI coverage in `src/index.test.ts`, added formatter coverage in `src/supervisor/replay-corpus.test.ts`, and fixed the CLI spawn helper to use `npx tsx` instead of assuming a local `node_modules/tsx/dist/cli.mjs` path.
- Current blocker: none
- Next exact step: review the resulting diff, commit the replay corpus CLI checkpoint on `codex/issue-545`, and prepare the branch for the next execution phase.
- Verification gap: none for the scoped CLI summary slice; broader full-suite verification has not been run.
- Files touched: `src/core/types.ts`, `src/index.ts`, `src/index.test.ts`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`, `package-lock.json`
- Rollback concern: removing the new formatter helpers or CLI branch would drop the compact corpus UX while leaving the underlying replay runner semantics intact.
- Last focused command: `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts && npm run build`
### Scratchpad
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
