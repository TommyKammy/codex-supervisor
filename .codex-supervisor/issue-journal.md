# Issue #617: Index refactor: extract supervisor bootstrap and loop orchestration

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/617
- Branch: codex/issue-617
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0fe84e4dd946b08cc771f5b40b81bdebb0d5b1c5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T05:07:02.546Z

## Latest Codex Summary
- Extracted supervisor bootstrap and loop orchestration out of `src/index.ts` into `src/cli/supervisor-runtime.ts`, added focused runtime coverage for lock release and signal-driven loop shutdown, and verified with focused CLI tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #617 is satisfied by moving supervisor-only bootstrap, run-once locking, signal handling, and loop orchestration into a dedicated CLI runtime module while preserving the existing command behavior that `src/index.ts` exposes.
- What changed: added `src/cli/supervisor-runtime.ts` for `runOnceWithSupervisorLock(...)`, signal registration, GSD preflight, and loop dispatch; reduced `src/index.ts` to parse-and-dispatch wiring; and added focused runtime tests for lock release and signal-aborted loop sleep.
- Current blocker: none
- Next exact step: commit this extraction checkpoint on `codex/issue-617`, then open or update the draft PR with the focused verification notes.
- Verification gap: none for this extraction slice after `src/cli/supervisor-runtime.test.ts`, `src/index.test.ts`, and `npm run build` all passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/supervisor-runtime.ts`, `src/cli/supervisor-runtime.test.ts`, `src/index.ts`
- Rollback concern: reverting this checkpoint would move supervisor loop/bootstrap logic back into `src/index.ts` and drop the focused runtime regression coverage for signal-driven shutdown.
- Last focused command: `git status --short`; `sed -n '1,280p' src/index.ts`; `sed -n '1,320p' src/index.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts src/index.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #617 with a focused missing-module failure in `src/cli/supervisor-runtime.test.ts` (`Cannot find module './supervisor-runtime'`). Fixed it by extracting supervisor bootstrap/run-once/loop control into `src/cli/supervisor-runtime.ts`, shrinking `src/index.ts` to dispatch wiring, and adding a narrow runtime regression for signal-aborted loop sleep and lock release. Focused verification passed with `npx tsx --test src/cli/supervisor-runtime.test.ts src/index.test.ts` and `npm run build` after restoring local dev dependencies via `npm install`.
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
