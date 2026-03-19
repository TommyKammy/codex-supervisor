# Issue #626: Issue-lint test refactor: extract shared setup helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/626
- Branch: codex/issue-626
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5378a4254a0176a646c02bf714f2afb5d5013ae1
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T09:54:40.019Z

## Latest Codex Summary
- Extracted shared issue-lint fixture/report helpers, verified the focused diagnostics test plus `npm run build`, pushed `codex/issue-626`, and opened draft PR #630.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `src/supervisor/supervisor-diagnostics-issue-lint.test.ts` is ready to split into scenario-focused suites once its repeated state-file bootstrapping and stubbed `issueLint(...)` loading are extracted into shared helpers.
- What changed: reproduced the current baseline with `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, extracted `createIssueLintFixture()` into `src/supervisor/supervisor-test-helpers.ts`, and rewired the issue-lint diagnostics tests to reuse `loadIssueLintReport(issue)` while preserving the existing assertions and coverage.
- Current blocker: none
- Next exact step: monitor draft PR #630 (`https://github.com/TommyKammy/codex-supervisor/pull/630`) and continue with follow-up review or any remaining issue-lint suite split work if the parent issue stack advances.
- Verification gap: `npm run build` initially failed with `sh: 1: tsc: not found` until local dependencies were restored via `npm install`; after that, the focused issue-lint test and `npm run build` both passed.
- Files touched: `src/supervisor/supervisor-test-helpers.ts`, `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would put the duplicated issue-lint fixture and stubbed report-loading flow back into every scenario test, making the planned suite split riskier.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Pushed `codex/issue-626` and opened draft PR #630 (`https://github.com/TommyKammy/codex-supervisor/pull/630`) after the shared issue-lint helper extraction passed local verification.
- 2026-03-19 (JST): Reproduced the issue-lint diagnostics baseline with `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, then extracted shared `createIssueLintFixture()` and `loadIssueLintReport(...)` helpers into `src/supervisor/supervisor-test-helpers.ts` so later scenario-focused suites can reuse state bootstrapping and stubbed issue loading. Focused verification passed again with `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm run build` first failed with `sh: 1: tsc: not found`, so restored local dependencies with `npm install` and reran `npm run build` successfully.
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
