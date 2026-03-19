# Issue #623: Scheduler policy: skip Epic issues by default during runnable selection

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/623
- Branch: codex/issue-623
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bdc876f6fdfb5c5ca49f4a999b02e42f11ae961d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T07:55:46.595Z

## Latest Codex Summary
- Default runnable selection now skips `Epic:` umbrella issues by default, preserves explicit `skipTitlePrefixes` overrides, and keeps child issue selection unchanged. Added focused coverage for the config default and run-once issue selection; `npm run build` passes after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the scheduler already had deterministic title-prefix skipping; the missing behavior for #623 was that the default config did not skip `Epic:` issues, so runnable selection could still claim umbrella issues unless an operator preconfigured that prefix.
- What changed: reproduced the gap with a focused `loadConfig` default test, added a focused run-once selection test proving an `Epic:` parent is skipped while its runnable child is still selected, defaulted `skipTitlePrefixes` to `["Epic:"]` when omitted, and aligned the shipped config templates plus configuration docs with that default.
- Current blocker: none
- Next exact step: commit the Epic-skipping checkpoint on `codex/issue-623`, then open or update a draft PR for issue #623 from this branch.
- Verification gap: the focused default/selection tests and `npm run build` passed; the broader `src/config.test.ts` file still contains an unrelated pre-existing README assertion failure expecting a removed `## Provider Profiles` heading in `README.md`.
- Files touched: `src/core/config.ts`, `src/config.test.ts`, `src/run-once-issue-selection.test.ts`, `docs/configuration.md`, `supervisor.config.example.json`, `supervisor.config.copilot.json`, `supervisor.config.codex.json`, `supervisor.config.coderabbit.json`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore the unsafe default that lets `Epic:` umbrella issues compete with runnable child issues during normal selection.
- Last focused command: `npx tsx --test src/config.test.ts --test-name-pattern "loadConfig skips Epic titles by default during runnable selection"`; `npx tsx --test src/run-once-issue-selection.test.ts --test-name-pattern "resolveRunnableIssueContext skips Epic issues and selects a runnable child issue"`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #623 with a focused config default test that expected `skipTitlePrefixes` to default to `["Epic:"]` but got `[]`. Confirmed selection logic already honored configured skip prefixes by adding a focused `resolveRunnableIssueContext` regression that skipped an `Epic:` issue and selected its runnable child. Fixed the gap by defaulting omitted `skipTitlePrefixes` to `["Epic:"]`, updated shipped config templates/docs, reran the focused tests, restored missing local TypeScript tooling with `npm install`, and passed `npm run build`.
- 2026-03-19 (JST): Reframed the remaining CodeRabbit failure context as structured thread summaries, rewrote the latest summary journal link to be repository-relative, and prepared focused markdown/journal verification for the journal-only review repair.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851XZoF` locally by hyphenating `index-focused tests` in the working-notes verification sentence after confirming the other match was only the saved external review quote.
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
