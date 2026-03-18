# Issue #596: Replay-corpus refactor: extract promotion helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/596
- Branch: codex/issue-596
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7e2bb94f16efd798af66e2df56d0509e88cb9fca
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T23:28:54.172Z

## Latest Codex Summary
- Reproduced the missing promotion-helper extraction with a focused `src/supervisor/replay-corpus-promotion.test.ts` that initially failed on `Cannot find module './replay-corpus-promotion'`, then extracted case-id, normalization/promotion write, summary/hint, and outcome helpers out of `src/supervisor/replay-corpus.ts` while preserving the existing CLI and replay behavior. Focused promotion tests and `npm run build` passed after restoring local dev dependencies with `npm install`; committed as `6e039c1` and opened draft PR #606 (`https://github.com/TommyKammy/codex-supervisor/pull/606`).

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the promotion responsibility cluster is now extracted cleanly; remaining risk is limited to review feedback because the promotion-specific helper tests, existing CLI promotion regressions, and replay-corpus regressions all stayed green after the split.
- What changed: added `src/supervisor/replay-corpus-promotion-case-id.ts`, `src/supervisor/replay-corpus-promotion.ts`, `src/supervisor/replay-corpus-promotion-summary.ts`, and `src/supervisor/replay-corpus-outcome.ts`; moved case-id suggestion, promotion normalization/metadata writing, promotion summary/hint logic, and compact outcome normalization/formatting out of `src/supervisor/replay-corpus.ts`; re-exported those helpers through `src/supervisor/replay-corpus.ts`; and added focused coverage in `src/supervisor/replay-corpus-promotion.test.ts`.
- Current blocker: none
- Next exact step: watch draft PR #606 CI and address any review feedback on commit `6e039c1`.
- Verification gap: none; `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts src/supervisor/replay-corpus.test.ts src/index.test.ts --test-name-pattern "promotion|replay-corpus-promote|suggestReplayCorpusCaseIds|PromotionWorthinessHints|promoteCapturedReplaySnapshot|summarizeReplayCorpusPromotion"` and `npm run build` passed after `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus-outcome.ts`, `src/supervisor/replay-corpus-promotion-case-id.ts`, `src/supervisor/replay-corpus-promotion-summary.ts`, `src/supervisor/replay-corpus-promotion.test.ts`, `src/supervisor/replay-corpus-promotion.ts`, `src/supervisor/replay-corpus.ts`
- Rollback concern: reverting only part of the split would restore helper sprawl inside `replay-corpus.ts` and make subsequent replay-corpus refactors harder to isolate and review.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts src/supervisor/replay-corpus.test.ts src/index.test.ts --test-name-pattern "promotion|replay-corpus-promote|suggestReplayCorpusCaseIds|PromotionWorthinessHints|promoteCapturedReplaySnapshot|summarizeReplayCorpusPromotion"`; `npm install`; `npm run build`; `git push -u origin codex/issue-596`; `gh pr create --draft --base main --head codex/issue-596 --title "Extract replay corpus promotion helpers" ...`
### Scratchpad
- 2026-03-19 (JST): Pushed `codex/issue-596` and opened draft PR #606 (`https://github.com/TommyKammy/codex-supervisor/pull/606`) after the promotion-helper extraction passed focused verification and `npm run build`.
- 2026-03-19 (JST): Reproduced issue #596 with a focused promotion-helper regression in `src/supervisor/replay-corpus-promotion.test.ts`; it initially failed with `Cannot find module './replay-corpus-promotion'` because promotion extraction modules did not exist yet. Fixed it by extracting case-id suggestion, promotion normalization/metadata writing, promotion summary/hint logic, and compact outcome helpers into dedicated `src/supervisor/replay-corpus-*.ts` modules and re-exporting them through `src/supervisor/replay-corpus.ts`. Verification passed with `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts src/supervisor/replay-corpus.test.ts src/index.test.ts --test-name-pattern "promotion|replay-corpus-promote|suggestReplayCorpusCaseIds|PromotionWorthinessHints|promoteCapturedReplaySnapshot|summarizeReplayCorpusPromotion"` and `npm run build` after `npm install`.
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
