# Issue #597: Replay-corpus refactor: extract reporting and mismatch-formatting helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/597
- Branch: codex/issue-597
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2f8a2a265c96a414657af2a0d8c09472eb4ce7e6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T00:01:22.869Z

## Latest Codex Summary
- Reproduced the helper-extraction gap with focused module-level replay-corpus tests that failed on missing `replay-corpus-mismatch-formatting` and `replay-corpus-mismatch-artifact` modules, then extracted the mismatch/reporting and artifact helpers out of `src/supervisor/replay-corpus.ts` while preserving output and artifact semantics. Focused replay-corpus verification and `npm run build` now pass.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the replay-corpus reporting refactor is complete for this slice because mismatch formatting, run-summary formatting, and mismatch artifact shaping now live in dedicated modules with direct tests that pin the existing CI-facing strings and artifact payloads.
- What changed: added `src/supervisor/replay-corpus-mismatch-formatting.ts` and `src/supervisor/replay-corpus-mismatch-artifact.ts`, added focused tests for each new module, and trimmed `src/supervisor/replay-corpus.ts` down to orchestration plus re-exports.
- Current blocker: none
- Next exact step: commit the replay-corpus reporting/artifact split on `codex/issue-597`, then open or update the draft PR if one is not already present.
- Verification gap: none for the local refactor slice; focused replay-corpus tests and `npm run build` both passed after restoring local dev dependencies with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus-mismatch-formatting.ts`, `src/supervisor/replay-corpus-mismatch-formatting.test.ts`, `src/supervisor/replay-corpus-mismatch-artifact.ts`, `src/supervisor/replay-corpus-mismatch-artifact.test.ts`
- Rollback concern: reverting this split would push CI-facing replay mismatch formatting and artifact shaping back into `replay-corpus.ts`, increasing coupling again without changing semantics.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/replay-corpus-mismatch-formatting.test.ts src/supervisor/replay-corpus-mismatch-artifact.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #597 by adding focused module-level tests for `replay-corpus-mismatch-formatting` and `replay-corpus-mismatch-artifact`; the first run failed with `MODULE_NOT_FOUND` for both new modules. Implemented the split by moving mismatch detail/summary/run-summary formatting into `src/supervisor/replay-corpus-mismatch-formatting.ts` and mismatch artifact shaping/sync into `src/supervisor/replay-corpus-mismatch-artifact.ts`, then re-exported them from `src/supervisor/replay-corpus.ts`. Verification passed with `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/replay-corpus-mismatch-formatting.test.ts src/supervisor/replay-corpus-mismatch-artifact.test.ts` and `npm run build` after a local `npm install` because `tsc` was initially unavailable.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851UWEj` by changing the provider-wait promotion hint guard to use a non-nullish check for `configuredBotCurrentHeadObservedAt` and adding a focused regression for the missing-field case. The first new assertion failed because the shared snapshot fixture still emitted `retry-escalation` via `timeout_retry_count=1`; after zeroing the retry counters in the test setup, `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts` passed and `npm run build` remained green.
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
