# Issue #638: Command error hygiene: add focused tests for redacted and bounded command errors

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/638
- Branch: codex/issue-638
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 7 (implementation=7, repair=0)
- Last head SHA: ce5f08d8cff38867946db2bdb8d59cdf9be25124
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 1
- Updated at: 2026-03-19T23:44:54+09:00

## Latest Codex Summary
The branch was not actually stable: rerunning `npx tsx --test src/core/command.test.ts` exposed a failure in the timeout bounded-`stderr` case because the test assumed pre-timeout `stderr` would always flush before the supervisor sent `SIGTERM`. I kept the scope narrow and updated [src/core/command.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-638/src/core/command.test.ts) so the timeout case emits the large `stderr` payload from a `SIGTERM` handler instead, which still exercises the redacted/bounded timeout error shape without relying on a race.

Focused verification now passes again with `npx tsx --test src/core/command.test.ts` and `npm run build`. The pre-existing untracked `.codex-supervisor/replay/` directory was left untouched.

Summary: Stabilized the timeout bounded-`stderr` regression test by making the child emit noisy `stderr` from a `SIGTERM` handler, then reran the focused command-runner test file and build successfully.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/core/command.test.ts`; `npm run build`
Failure signature: none
Next action: commit this focused test-only stabilization, push `codex/issue-638`, and open or update the draft PR for review

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the command-runner behavior from `#639` and `#640` is still correct; the instability was in the timeout bounded-`stderr` test, which relied on a race between initial `stderr` writes and timeout-driven `SIGTERM`.
- What changed: re-ran `git status --short --branch`, `git rev-list --left-right --count origin/main...HEAD`, `gh pr status`, `sed -n '1,260p' src/core/command.test.ts`, `npx tsx --test src/core/command.test.ts`, and `npm run build`; the focused test initially failed on `runCommand timeout errors bound noisy stderr while keeping timeout context` because the error lacked `timeout-prefix`. Updated `src/core/command.test.ts` so the timeout case writes `NOISY_STDERR` from a `SIGTERM` handler and reran the focused test file plus build successfully.
- Current blocker: none
- Next exact step: commit the stabilized timeout test, push `codex/issue-638`, and open a draft PR so review can focus on the test-only fix.
- Verification gap: none for the scoped acceptance criteria; I ran the focused command-runner test file and `npm run build`, but not the full repository test suite because the issue specifically asks for focused verification plus build.
- Files touched: `src/core/command.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore the timeout-test race and make the focused command-runner coverage flaky again.
- Last focused command: `git status --short --branch`; `git rev-list --left-right --count origin/main...HEAD`; `gh pr status`; `sed -n '1,260p' src/core/command.test.ts`; `npx tsx --test src/core/command.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Rerunning the focused command-runner tests on `ce5f08d` exposed that the timeout bounded-`stderr` case was flaky; it assumed noisy `stderr` written before the timeout would always be captured before `SIGTERM`. Stabilized the test by emitting `NOISY_STDERR` from a `SIGTERM` handler instead, then reran `npx tsx --test src/core/command.test.ts` and `npm run build` successfully.
- 2026-03-19 (JST): Reproduced issue #637 with focused `runCommand` failures that emitted 1.2k-character `stderr` payloads; initial tests failed because thrown non-zero and timeout errors included the full `stderr` body. Fixed `src/core/command.ts` so error messages splice oversized `stderr` with a deterministic middle ellipsis while preserving both the prefix and suffix, including the timeout marker appended at the end. Focused verification passed with `npx tsx --test src/core/command.test.ts` and `npm run build` after `npm install`.
- 2026-03-19 (JST): Reproduced issue #561 with a focused docs regression in `src/agent-instructions-docs.test.ts`; it failed with `ENOENT` because `docs/agent-instructions.md` did not exist. Added the new bootstrap hub doc with prerequisites, read order, first-run sequence, escalation rules, and canonical links. Focused verification passed with `npx tsx --test src/agent-instructions-docs.test.ts src/getting-started-docs.test.ts` and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
