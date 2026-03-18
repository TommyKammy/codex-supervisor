# Issue #546: Replay corpus CI: surface the compact summary in pull request output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/546
- Branch: codex/issue-546
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 1e04150e9cabc51f4716cdd39a855134a3c519f7
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-18T13:33:49.050Z

## Latest Codex Summary
Wired PR CI to print the compact replay-corpus summary by adding an Ubuntu-only `replay-corpus` step in [ci.yml](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-546/.github/workflows/ci.yml) before the build, and added a narrow workflow regression in [ci-workflow.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-546/src/ci-workflow.test.ts) to keep that path covered.

Committed as `1e04150` (`Surface replay corpus summary in CI`), pushed `codex/issue-546`, and opened draft PR #549: https://github.com/TommyKammy/codex-supervisor/pull/549

Summary: Added workflow coverage for PR-facing replay-corpus output and updated CI to surface the compact summary once per PR run.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/ci-workflow.test.ts`; `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #549 CI and address any review or workflow follow-up if the new replay-corpus step exposes issues.

## Active Failure Context
- Category: checks
- Summary: PR #549 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/549
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23246580619/job/67576525574

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining Ubuntu CI failure is not in the workflow wiring itself; `src/index.ts` still required `supervisor.config.json` before running `replay-corpus`, so the new PR-facing step failed immediately in Actions because this repo does not check in a runtime supervisor config.
- What changed: added a checked-in replay-corpus config helper in `src/supervisor/replay-corpus.ts`, taught `src/index.ts` to use it for the default `replay-corpus` command when `--config` is omitted, and added `src/index.test.ts` coverage for the config-free CLI path that CI invokes.
- Current blocker: none
- Next exact step: commit and push the replay-corpus config fallback, then monitor draft PR #549 for a green Ubuntu rerun.
- Verification gap: focused replay-corpus CLI, replay-corpus/workflow tests, and `npm run build` passed locally; broader full-suite verification has not been run.
- Files touched: `src/index.ts`, `src/index.test.ts`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: dropping the default replay-corpus config fallback would put PR CI back into a hard failure state whenever `supervisor.config.json` is absent, which is the normal state for this repository checkout.
- Last focused command: `npx tsx src/index.ts replay-corpus && npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts src/ci-workflow.test.ts && npm run build`
### Scratchpad
- 2026-03-18 (JST): Pulled the failing Ubuntu Actions log for job `67576525574`; the new `npx tsx src/index.ts replay-corpus` step failed with `Config file not found: /home/runner/work/codex-supervisor/codex-supervisor/supervisor.config.json`. Added a checked-in replay-corpus config fallback plus a config-free CLI regression, then reran `npx tsx src/index.ts replay-corpus`, `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts src/ci-workflow.test.ts`, and `npm run build` successfully.
- 2026-03-18 (JST): Wired `.github/workflows/ci.yml` to run `npx tsx src/index.ts replay-corpus` on the Ubuntu matrix leg, adjusted the workflow regex test to match the YAML step block, and reran `npx tsx --test src/ci-workflow.test.ts`, `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`, `npm ci`, and `npm run build` successfully.
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
