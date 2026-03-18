# Issue #547: Replay corpus artifacts: emit full mismatch details only for failing runs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/547
- Branch: codex/issue-547
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 31da79d10755fe4ffbd5ba445385d1f3a7f8659c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T23:42:56+09:00

## Latest Codex Summary
Updated [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-547/.codex-supervisor/issue-journal.md#L1) so its verification record now matches the focused replay-corpus, CLI, and workflow coverage actually used for PR #550. The review-only journal fix was committed as `31da79d`, pushed to `codex/issue-547`, and the remaining CodeRabbit thread on PR `#550` was resolved.

Verification passed with `npx tsx --test src/supervisor/replay-corpus.test.ts src/index.test.ts src/ci-workflow.test.ts` and `npm run build`. Local status is clean aside from the pre-existing untracked `.codex-supervisor/replay/decision-cycle-snapshot.json`.

Summary: Aligned the journal’s recorded verification scope with the actual replay-corpus, CLI, and workflow coverage, pushed the journal fix, and resolved the remaining PR review thread.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/supervisor/replay-corpus.test.ts src/index.test.ts src/ci-workflow.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #550 CI on `31da79d` and address any new review or workflow follow-up if it appears.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread was valid because the journal still advertised only `src/ci-workflow.test.ts`, which understated the focused replay-corpus/CLI/workflow verification already expected for this PR.
- What changed: updated `.codex-supervisor/issue-journal.md` so the recorded verification explicitly lists `src/supervisor/replay-corpus.test.ts`, `src/index.test.ts`, `src/ci-workflow.test.ts`, and `npm run build`, then pushed `31da79d` and resolved the remaining review thread.
- Current blocker: none
- Next exact step: monitor PR #550 CI on `31da79d` and handle any follow-up review or workflow regressions if they appear.
- Verification gap: focused replay-corpus (`src/supervisor/replay-corpus.test.ts`), CLI (`src/index.test.ts`), and workflow (`src/ci-workflow.test.ts`) tests plus `npm run build` passed locally; broader full-suite verification has not been run.
- Files touched: `.codex-supervisor/issue-journal.md`, `.github/workflows/ci.yml`, `src/ci-workflow.test.ts`, `src/index.ts`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: reverting the journal fix would reopen reviewer confusion about what focused coverage was actually run for this PR, even though the underlying replay artifact behavior is already correct.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus.test.ts src/index.test.ts src/ci-workflow.test.ts`; `npm run build`
### Scratchpad
- 2026-03-18 (JST): Verified the remaining PR #550 journal review finding was valid in the current snapshot, updated the recorded Tests line and verification notes to list `src/supervisor/replay-corpus.test.ts`, `src/index.test.ts`, `src/ci-workflow.test.ts`, and `npm run build`, reran that focused command plus build successfully, committed `31da79d` (`Align journal verification scope with replay tests`), pushed `codex/issue-547`, and resolved thread `PRRT_kwDORgvdZ851LV_Q`.
- 2026-03-18 (JST): Verified the remaining PR #550 CodeRabbit finding against `.github/workflows/ci.yml`; it was valid because the artifact upload used global `failure()`. Added a `replay_corpus` step id, gated upload on `steps.replay_corpus.outcome == 'failure'`, updated `src/ci-workflow.test.ts`, and reran `npx tsx --test src/ci-workflow.test.ts` plus `npm run build` successfully.
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
