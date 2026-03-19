# Issue #670: Model routing: route generic local-review roles through GPT-5.4 mini when configured

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/670
- Branch: codex/issue-670
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5f9c241d919fbb2d43bcef4465b97deeb8fa7189
- Blocked reason: none
- Last failure signature: docs-researcher-routed-as-specialist
- Repeated failure signature count: 0
- Updated at: 2026-03-19T22:38:06Z

## Latest Codex Summary
- Reproduced the missing generic-role routing with a focused `docs_researcher` runner regression, fixed the classifier so `reviewer`, `explorer`, and `docs_researcher` all use the generic local-review target, and reran focused routing tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining issue-670 gap after #669 was role classification, not config/policy plumbing. `docs_researcher` was still classified as a specialist reviewer, so it bypassed the generic local-review mini route even when `localReviewModelStrategy` / `localReviewModel` were configured.
- What changed: added a focused `runRoleReview(...)` regression proving `docs_researcher` was sent to `local_review_specialist`, added a preserved-path check for `prisma_postgres_reviewer`, and fixed `reviewerTypeForRole(...)` so the generic role set is explicitly `reviewer`, `explorer`, and `docs_researcher`.
- Current blocker: none
- Next exact step: commit the issue-670 routing fix on `codex/issue-670`, then open or update the draft PR and watch CI.
- Verification gap: none for the scoped issue work. Focused runner/config/policy tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `src/local-review/thresholds.ts`, `src/local-review/runner.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would route `docs_researcher` back through the specialist/main-model path, leaving generic local-review mini routing incomplete for the staged rollout in #668.
- Last focused command: `npx tsx --test src/local-review/runner.test.ts src/codex/codex-policy.test.ts`; `npx tsx --test src/core/config-local-review-model-routing.test.ts`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced issue #670 with a focused `runRoleReview` regression: `docs_researcher` was classified as `local_review_specialist` instead of `local_review_generic`, while a specialist preservation check already passed. Fixed `reviewerTypeForRole(...)` by making the generic role set explicit (`reviewer`, `explorer`, `docs_researcher`), restored local dev dependencies with `npm install`, and passed `npx tsx --test src/local-review/runner.test.ts src/codex/codex-policy.test.ts`, `npx tsx --test src/core/config-local-review-model-routing.test.ts`, and `npm run build`.
- 2026-03-20 (JST): Pushed `codex/issue-660` and opened draft PR #667 (`https://github.com/TommyKammy/codex-supervisor/pull/667`) after the focused doctor/state-store verification and build had already passed locally.
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851kRrS` as a real bug: malformed SQLite rows could yield only `load_findings`, after which `loadFromSqlite()` returned fallback empty/bootstrap state without those findings. Fixed the fallback path, added a dedicated regression for the empty-state case, and reran `npx tsx --test src/core/state-store.test.ts` plus `npm run build` successfully.
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
