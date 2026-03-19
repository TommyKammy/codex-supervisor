# Issue #598: Replay-corpus refactor: slim replay-corpus.ts into a thin facade

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/598
- Branch: codex/issue-598
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6e37aa7f08c9c82b0d987bde286625b0f30f0a65
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T00:20:46.257Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #598 is satisfied because `src/supervisor/replay-corpus.ts` is now a thin export-only facade while checked-in replay config and corpus execution moved into dedicated modules with focused tests pinned to those boundaries.
- What changed: added `src/supervisor/replay-corpus-config.ts` and `src/supervisor/replay-corpus-runner.ts` with dedicated tests, rewrote `src/supervisor/replay-corpus.test.ts` into a facade re-export smoke test, pointed mismatch-artifact coverage at `replay-corpus-config.ts`, and reused `loadReplayCorpus(...)` from `src/supervisor/replay-corpus-runner.ts` inside `src/supervisor/replay-corpus-promotion.ts`.
- Current blocker: none
- Next exact step: commit the replay-corpus facade slimming on `codex/issue-598`, then open or update the draft PR if one is not already present.
- Verification gap: none for the local refactor slice; focused replay-corpus tests and `npm run build` both passed after restoring local dev dependencies with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`, `src/supervisor/replay-corpus-config.ts`, `src/supervisor/replay-corpus-config.test.ts`, `src/supervisor/replay-corpus-runner.ts`, `src/supervisor/replay-corpus-runner.test.ts`, `src/supervisor/replay-corpus-mismatch-artifact.test.ts`, `src/supervisor/replay-corpus-promotion.ts`
- Rollback concern: reverting this split would pull checked-in replay config and corpus execution back into `replay-corpus.ts`, restoring the broad facade/catch-all shape without changing replay behavior.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/replay-corpus-config.test.ts src/supervisor/replay-corpus-runner.test.ts src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus-promotion.test.ts src/supervisor/replay-corpus-mismatch-formatting.test.ts src/supervisor/replay-corpus-mismatch-artifact.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #598 by adding dedicated `replay-corpus-config` and `replay-corpus-runner` tests; the first run failed with `MODULE_NOT_FOUND` for `./replay-corpus-config` and `./replay-corpus-runner`, confirming the facade still owned those responsibilities. Fixed it by extracting `createCheckedInReplayCorpusConfig(...)` and `loadReplayCorpus(...)`/`runReplayCorpus(...)` into new modules, slimming `replay-corpus.ts` to re-exports, and shrinking `replay-corpus.test.ts` into a facade smoke test. Focused verification passed with `npx tsx --test src/supervisor/replay-corpus.test.ts src/supervisor/replay-corpus-config.test.ts src/supervisor/replay-corpus-runner.test.ts src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus-promotion.test.ts src/supervisor/replay-corpus-mismatch-formatting.test.ts src/supervisor/replay-corpus-mismatch-artifact.test.ts`; `npm run build` first failed with `sh: 1: tsc: not found`, so ran `npm install` and reran `npm run build` successfully.
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
