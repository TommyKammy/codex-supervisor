# Issue #547: Replay corpus artifacts: emit full mismatch details only for failing runs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/547
- Branch: codex/issue-547
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: c830e3eac8bc638c49243edf00fdbdfb0610a43f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851LKd-
- Repeated failure signature count: 1
- Updated at: 2026-03-18T14:05:49.987Z

## Latest Codex Summary
Added failure-only replay mismatch artifact handling in [replay-corpus.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-547/src/supervisor/replay-corpus.ts) and wired the CLI in [index.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-547/src/index.ts) to write `.codex-supervisor/replay/replay-corpus-mismatch-details.json` only when mismatches exist, while clearing stale artifacts on all-pass runs. CI now uploads that file only on failed Ubuntu replay runs via [ci.yml](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-547/.github/workflows/ci.yml), and the focused regressions are in [replay-corpus.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-547/src/supervisor/replay-corpus.test.ts) and [ci-workflow.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-547/src/ci-workflow.test.ts).

Committed as `989aaa3` and `c830e3e`, pushed `codex/issue-547`, and opened draft PR [#550](https://github.com/TommyKammy/codex-supervisor/pull/550). The journal was updated in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-547/.codex-supervisor/issue-journal.md).

Summary: Added deterministic replay-corpus mismatch details artifacts for failing runs only, uploaded them from CI on replay failure, verified locally, and opened draft PR #550.
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npx tsx --test src/supervisor/replay-corpus.test.ts src/ci-workflow.test.ts`; `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts src/ci-workflow.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #550 CI and address any workflow or review follow-up if the new failure-only artifact path surfaces issues.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/550#discussion_r2953669979
- Details:
  - .github/workflows/ci.yml:38 _⚠️ Potential issue_ | _🟡 Minor_ <details> <summary>🧩 Analysis chain</summary> 🌐 Web query: `In GitHub Actions, does failure() evaluate true if any prior step fails, and is `steps.<step_id>.outcome == 'failure'` the correct way to gate a step on one specific prior step failing?` 💡 Result: Yes. - `failure()` is a **status-check function** that returns `true` **when any previous step in the current job has failed** (and for dependent jobs, if any ancestor job failed). GitHub’s docs also note that to run a step “after a failure” you must include a status-check function like `failure()` (otherwise an implicit `success()` is applied to the `if`). ([docs.github.com](https://docs.github.com/en/enterprise-server%403.15/actions/reference/workflows-and-actions/expressions?utm_source=openai)) - To gate on **one specific prior step**, `steps.<step_id>.outcome == 'failure'` is the right signal **(it’s the result *before* `continue-on-error` is applied)**. If you care about the post–`continue-on-error` result, use `steps.<step_id>.conclusion`. ([docs.github.com](https://docs.github.com/en/actions/reference/contexts-reference?from=20421&from_column=20421&utm_source=openai)) Practical pattern (so it still runs even though the job is already “failing”): ```yaml - name: Run only if step X failed if: ${{ failure() && steps.x.outcome == 'failure' }} run: echo "step x failed" ``` (`steps.x.outcome == 'failure'` alone usually won’t run after a failure because of the implicit `success()` behavior.) ([docs.github.com](https://docs.github.com/en/enterprise-server%403.15/actions/reference/workflows-and-actions/expressions?utm_source=openai)) Citations: - 1: https://docs.github.com/en/enterprise-server%403.15/actions/reference/workflows-and-actions/expressions?utm_source=openai - 2: https://docs.github.com/en/actions/reference/contexts-reference?from=20421&from_column=20421&utm_source=openai - 3: https://docs.github.com/en/enterprise-server%403.15/actions/reference/workflows-and-actions/expressions?utm_source=openai --- </details> **Scope artifact upload to replay-corpus step failure only.** Line 34 uses `failure()`, which also becomes true when *other* earlier steps fail. That widens upload behavior beyond the replay-corpus failure path. To fix this, add an `id` to the replay-corpus step and gate the upload on that specific step's outcome: <details> <summary>Suggested patch</summary> ```diff - if: matrix.os == 'ubuntu-latest' + id: replay_corpus run: npx tsx src/index.ts replay-corpus - - if: ${{ failure() && matrix.os == 'ubuntu-latest' }} + - if: ${{ failure() && matrix.os == 'ubuntu-latest' && steps.replay_corpus.outcome == 'failure' }} uses: actions/upload-artifact@v4 with: name: replay-corpus-mismatch-details path: .codex-supervisor/replay/replay-corpus-mismatch-details.json ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.github/workflows/ci.yml around lines 34 - 38, The upload is gated on global failure() which triggers for any earlier failing step; add an id to the replay-corpus step (e.g. id: replay-corpus) and change the upload step's condition to check that step's outcome (e.g. if: ${{ steps.replay-corpus.outcome == 'failure' && matrix.os == 'ubuntu-latest' }}) so the artifact upload only runs when the replay-corpus step itself fails. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review failure was valid because the artifact upload step still used global `failure()`, so any earlier Ubuntu step failure could upload replay mismatch details even when `replay-corpus` itself had not failed.
- What changed: added a `replay_corpus` step id in `.github/workflows/ci.yml`, narrowed the artifact upload condition to `failure() && steps.replay_corpus.outcome == 'failure'`, and updated `src/ci-workflow.test.ts` to lock in the narrower workflow contract.
- Current blocker: none
- Next exact step: commit and push the workflow review fix to `codex/issue-547`, then resolve the remaining CodeRabbit thread on PR #550 if no new issues appear.
- Verification gap: focused replay-corpus/CLI/workflow tests and `npm run build` passed locally; broader full-suite verification has not been run.
- Files touched: `.github/workflows/ci.yml`, `src/ci-workflow.test.ts`, `src/index.ts`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: removing the artifact sync would leave CI with only the compact summary and no deterministic mismatch details for failing replay-corpus runs, making review/debugging on failures materially worse again.
- Last focused command: `npx tsx --test src/ci-workflow.test.ts`; `npm run build`
### Scratchpad
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
