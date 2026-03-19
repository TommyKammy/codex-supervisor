# Issue #617: Index refactor: extract supervisor bootstrap and loop orchestration

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/617
- Branch: codex/issue-617
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 662c046de346b5ecd24503191c727f1b4dac0177
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T05:20:06Z

## Latest Codex Summary
Opened draft PR #621 (`https://github.com/TommyKammy/codex-supervisor/pull/621`) for the extracted supervisor runtime checkpoint on `codex/issue-617` after pushing the branch upstream. The implementation remains the same: [`src/index.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-617/src/index.ts) now only parses and dispatches commands, while [`src/cli/supervisor-runtime.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-617/src/cli/supervisor-runtime.ts) owns lock-protected run-once execution, GSD preflight, signal handling, and loop orchestration.

Reran focused verification with `npx tsx --test src/cli/supervisor-runtime.test.ts src/index.test.ts` and `npm run build`; both passed cleanly. The only remaining worktree changes are this journal update and the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Pushed the supervisor runtime extraction checkpoint, reran focused verification, and opened draft PR #621 for issue #617.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/cli/supervisor-runtime.test.ts src/index.test.ts`; `npm run build`
Failure signature: none
Next action: monitor draft PR #621 for review or CI feedback and address follow-up if any appears

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #617 is satisfied by moving supervisor-only bootstrap, run-once locking, signal handling, and loop orchestration into a dedicated CLI runtime module while preserving the existing command behavior that `src/index.ts` exposes.
- What changed: added `src/cli/supervisor-runtime.ts` for `runOnceWithSupervisorLock(...)`, signal registration, GSD preflight, and loop dispatch; reduced `src/index.ts` to parse-and-dispatch wiring; added focused runtime tests for lock release and signal-aborted loop sleep; and opened draft PR #621 for the checkpoint.
- Current blocker: none
- Next exact step: wait for CI/review on draft PR #621 and handle any follow-up without broadening the extraction scope.
- Verification gap: none for this extraction slice after `src/cli/supervisor-runtime.test.ts`, `src/index.test.ts`, and `npm run build` all passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/supervisor-runtime.ts`, `src/cli/supervisor-runtime.test.ts`, `src/index.ts`
- Rollback concern: reverting this checkpoint would move supervisor loop/bootstrap logic back into `src/index.ts` and drop the focused runtime regression coverage for signal-driven shutdown.
- Last focused command: `git status --short`; `git branch -vv`; `gh pr status`; `npx tsx --test src/cli/supervisor-runtime.test.ts src/index.test.ts`; `npm run build`; `git push -u origin codex/issue-617`; `gh pr create --draft --base main --head codex/issue-617 --title "Extract supervisor CLI runtime orchestration" ...`
### Scratchpad
- 2026-03-19 (JST): Reran focused verification for the supervisor runtime extraction with `npx tsx --test src/cli/supervisor-runtime.test.ts src/index.test.ts` and `npm run build`, pushed `codex/issue-617` to `origin`, and opened draft PR #621 (`https://github.com/TommyKammy/codex-supervisor/pull/621`).
- 2026-03-19 (JST): Addressed CodeRabbit threads `PRRT_kwDORgvdZ851W7DO` and `PRRT_kwDORgvdZ851W7DQ` by resolving the default replay-corpus path inside the extracted handler layer and by skipping config loading on the missing-`caseId` advisory branch. Focused verification passed with `npx tsx --test src/cli/replay-handlers.test.ts src/index.test.ts` and `npm run build`.
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
