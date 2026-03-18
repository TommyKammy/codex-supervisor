# Issue #595: Replay-corpus refactor: extract validation and case-loading helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/595
- Branch: codex/issue-595
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b98b5b8298b6b01cf1d94a707706c352d8b23228
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T23:06:28.962Z

## Latest Codex Summary
- Extracted replay-corpus validation and canonical case-loading helpers into dedicated modules, added focused helper coverage, and verified the replay-corpus slice plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the replay-corpus refactor is complete for the validation and canonical loading slice; remaining risk is limited to review feedback because the focused helper tests and existing replay-corpus regression suite stayed green after extraction.
- What changed: added `src/supervisor/replay-corpus-model.ts`, `src/supervisor/replay-corpus-validation.ts`, and `src/supervisor/replay-corpus-loading.ts`; moved manifest/metadata/expected-result/snapshot validation plus canonical case-bundle loading into those modules; slimmed `src/supervisor/replay-corpus.ts` down to imports; and added focused helper coverage in `src/supervisor/replay-corpus-loading.test.ts`.
- Current blocker: none
- Next exact step: commit the refactor checkpoint, open a draft PR for `codex/issue-595`, and watch for review feedback.
- Verification gap: none; `npx tsx --test src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus.test.ts` and `npm run build` passed after `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus-loading.test.ts`, `src/supervisor/replay-corpus-loading.ts`, `src/supervisor/replay-corpus-model.ts`, `src/supervisor/replay-corpus-validation.ts`, `src/supervisor/replay-corpus.ts`
- Rollback concern: reverting only part of the split would likely restore duplicate validation/loading logic and re-entangle `replay-corpus.ts`, making later replay-corpus refactors riskier.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #595 with a focused new `src/supervisor/replay-corpus-loading.test.ts` import failure because dedicated replay-corpus loading/validation modules did not exist. Fixed it by extracting shared replay-corpus types/constants into `replay-corpus-model.ts`, moving validation into `replay-corpus-validation.ts`, moving canonical manifest/case loading into `replay-corpus-loading.ts`, and updating `replay-corpus.ts` to consume those helpers. Verification passed with `npx tsx --test src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus.test.ts` and `npm run build` after `npm install`.
- 2026-03-19 (JST): Reproduced issue #573 with a focused `issue-lint` regression: an authored issue containing `Part of: #104`, duplicate/self `Depends on`, `Execution order: 3 of 2`, and `Parallelizable: Later` still reported `execution_ready=yes` and no metadata problems. Fixed it by adding local metadata validation and a `metadata_errors=` summary line, then verified with `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build` after restoring local deps via `npm install`.
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
