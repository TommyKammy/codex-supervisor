# Issue #533: Replay corpus: add a corpus runner that asserts normalized replay outcomes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/533
- Branch: codex/issue-533
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 68c598b31b98390e9271bdd3014694c4ccac1266
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851FsAf
- Repeated failure signature count: 1
- Updated at: 2026-03-18T08:40:51.307Z

## Latest Codex Summary
Opened draft PR [#539](https://github.com/TommyKammy/codex-supervisor/pull/539) for `codex/issue-533`, pushed the existing implementation commit plus a journal handoff update (`68c598b`), and cleaned the generated `.codex-supervisor/replay/` output so the worktree is clean. The branch now contains the replay corpus runner work in [`src/supervisor/replay-corpus.ts`](src/supervisor/replay-corpus.ts) and focused coverage in [`src/supervisor/replay-corpus.test.ts`](src/supervisor/replay-corpus.test.ts).

Verification re-passed with `npx tsx --test src/supervisor/replay-corpus.test.ts` and `npm run build`. I did not run the full test suite.

Summary: Pushed the replay corpus runner branch, opened draft PR #539, updated the issue journal handoff, and left the worktree clean
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/replay-corpus.test.ts`; `npm run build`
Failure signature: none
Next action: monitor draft PR #539 for review or CI feedback and address any follow-up if it appears

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/539#discussion_r2951765830
- Details:
  - .codex-supervisor/issue-journal.md:17 _⚠️ Potential issue_ | _🟡 Minor_ **Use repo-relative links instead of absolute local filesystem paths.** The links in this journal entry are machine-specific and won’t resolve for other contributors or in GitHub UI. <details> <summary>🛠️ Proposed fix</summary> ```diff -Implemented the replay corpus runner in [src/supervisor/replay-corpus.ts](src/supervisor/replay-corpus.ts) and added focused success/mismatch coverage in [src/supervisor/replay-corpus.test.ts](src/supervisor/replay-corpus.test.ts). The new surface replays manifest-discovered cases in order, normalizes outcomes to the expected persisted shape, and formats deterministic mismatch output. The implementation remains committed as `995318a` (`Add replay corpus runner`), pushed to `origin/codex/issue-533`, and is now in draft PR `#539`: `https://github.com/TommyKammy/codex-supervisor/pull/539`. +Implemented the replay corpus runner in [src/supervisor/replay-corpus.ts](src/supervisor/replay-corpus.ts) and added focused success/mismatch coverage in [src/supervisor/replay-corpus.test.ts](src/supervisor/replay-corpus.test.ts). The new surface replays manifest-discovered cases in order, normalizes outcomes to the expected persisted shape, and formats deterministic mismatch output. The implementation remains committed as `995318a` (`Add replay corpus runner`), pushed to `origin/codex/issue-533`, and is now in draft PR `#539`: `https://github.com/TommyKammy/codex-supervisor/pull/539`. ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion Implemented the replay corpus runner in [src/supervisor/replay-corpus.ts](src/supervisor/replay-corpus.ts) and added focused success/mismatch coverage in [src/supervisor/replay-corpus.test.ts](src/supervisor/replay-corpus.test.ts). The new surface replays manifest-discovered cases in order, normalizes outcomes to the expected persisted shape, and formats deterministic mismatch output. The implementation remains committed as `995318a` (`Add replay corpus runner`), pushed to `origin/codex/issue-533`, and is now in draft PR `#539`: `https://github.com/TommyKammy/codex-supervisor/pull/539`. ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 17, replace the journal entry links with repo-relative paths like src/supervisor/replay-corpus.ts and src/supervisor/replay-corpus.test.ts, and ensure any other absolute workspace-path references in .codex-supervisor/issue-journal.md are similarly converted to repo-relative links. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR #539 review item is limited to `.codex-supervisor/issue-journal.md`; converting the stored absolute workspace links and prompt text to repo-relative references should satisfy the thread without changing replay-runner behavior.
- What changed: sanitized `.codex-supervisor/issue-journal.md` so the Latest Codex Summary and stored review context now use repo-relative `src/supervisor/replay-corpus.ts` and `src/supervisor/replay-corpus.test.ts` references instead of absolute workspace paths, and removed the last literal absolute-workspace-path wording from the stored prompt text.
- Current blocker: none
- Next exact step: commit the journal-only review fix, push `codex/issue-533`, and resolve the CodeRabbit thread on PR #539 if the remote update succeeds.
- Verification gap: this turn only changed the journal text, so I verified with `rg` against absolute workspace-path and file-URI patterns in `.codex-supervisor/issue-journal.md`; I did not rerun `npx tsx --test src/supervisor/replay-corpus.test.ts` or `npm run build` because replay-runner code and tests were unchanged.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this journal-only fix would reintroduce machine-specific links into the stored handoff and keep the review thread open without improving replay behavior.
- Last focused command: `rg` search for absolute workspace-path and file-URI patterns in `.codex-supervisor/issue-journal.md`
### Scratchpad
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
