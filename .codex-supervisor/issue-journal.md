# Issue #615: Index refactor: extract CLI argument parsing

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/615
- Branch: codex/issue-615
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e89677a07e1a4e7b9a707bcf11f5df4b18b9fee0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T13:10:25+09:00

## Latest Codex Summary
- Extracted CLI argument parsing from `src/index.ts` into `src/cli/parse-args.ts`, moved the focused parser assertions into `src/cli/parse-args.test.ts`, and kept `src/index.ts` as the execution/orchestration entrypoint with a compatibility re-export for `parseArgs`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #615 is satisfied by keeping parser semantics unchanged while moving `parseArgs(...)` into a dedicated CLI module and leaving `src/index.ts` focused on command execution branches.
- What changed: added `src/cli/parse-args.test.ts` as the focused reproducer, confirmed it initially failed with `MODULE_NOT_FOUND` for `./parse-args`, created `src/cli/parse-args.ts` with the extracted parser logic, removed the parser unit cases from `src/index.test.ts`, and updated `src/index.ts` to import plus re-export `parseArgs` from the new module.
- Current blocker: none
- Next exact step: monitor draft PR #619 CI and review feedback, then address any failures or comments that land on `codex/issue-615`.
- Verification gap: none for the local slice; `npx tsx --test src/cli/parse-args.test.ts src/index.test.ts` passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/parse-args.ts`, `src/cli/parse-args.test.ts`, `src/index.ts`, `src/index.test.ts`
- Rollback concern: reverting this checkpoint would move argument parsing back into `src/index.ts` and drop the dedicated parser-focused test boundary that now guards the extraction.
- Last focused command: `npx tsx --test src/cli/parse-args.test.ts`; `npx tsx --test src/cli/parse-args.test.ts src/index.test.ts`; `npm install`; `npm run build`; `git commit -m "Extract CLI argument parsing module"`; `git push -u origin codex/issue-615`; `gh pr create --draft --base main --head codex/issue-615 ...`
### Scratchpad
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
