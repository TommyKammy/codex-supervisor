# Issue #559: Replay corpus promotion: surface conservative promotion-worthiness hints

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/559
- Branch: codex/issue-559
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f6ba8686c9cb92b35b921c2db7db88a51091511a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T17:01:53.227Z

## Latest Codex Summary
- Reproduced the missing replay promotion-worthiness guidance with a focused `replay-corpus-promote` CLI regression, then added deterministic advisory hints for stale-head safety, provider waits, and retry escalation. The CLI now surfaces those hints both when operators ask for case-id suggestions and after a successful promotion summary. Focused CLI and replay-corpus tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Replay corpus promotion still lacked operator-facing guidance about which captured snapshots are especially valuable to preserve, even though promotion invocation and review output already existed.
- What changed: tightened the CLI guidance path in `src/index.test.ts` to require advisory promotion hints for a high-value stale-head snapshot and no hints for a routine required-check snapshot; added `deriveReplayCorpusPromotionWorthinessHints(...)` in `src/supervisor/replay-corpus.ts` with conservative deterministic signals for stale-head safety, provider waits, and retry escalation; extended `summarizeReplayCorpusPromotion(...)` and `src/index.ts` so hints surface both in missing-case-id guidance and after successful promotions; added focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- Current blocker: none
- Next exact step: monitor CI and respond to any review or verification feedback on draft PR #582.
- Verification gap: no broader full-suite run yet; this slice was verified with focused CLI and replay-corpus tests plus `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/index.ts`, `src/index.test.ts`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: removing the new hint helper or CLI output would put operators back to manually inferring promotion-worthiness from raw snapshots, while making the helper less conservative would risk noisy or unstable hinting.
- Last focused command: `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`; `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
