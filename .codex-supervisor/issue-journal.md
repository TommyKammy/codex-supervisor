# Issue #627: Issue-lint test refactor: split readiness and metadata coverage

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/627
- Branch: codex/issue-627
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 573ae77b33085fdd92a9f84f05ed21a4e25a6659
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T10:15:54Z

## Latest Codex Summary
- Split readiness and metadata issue-lint coverage into focused test modules, preserved the existing assertions, and reverified the targeted suites plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the issue-lint split is complete for the readiness and metadata scenario family, with ambiguity coverage intentionally left in the original module until the later scenario-splitting issues land.
- What changed: reproduced the focused baseline with `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, moved clean readiness coverage into `src/supervisor/supervisor-diagnostics-issue-lint-readiness.test.ts`, moved missing-sections and metadata-validation coverage into `src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`, and left the high-risk ambiguity assertion in `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`.
- Current blocker: none
- Next exact step: commit this split on `codex/issue-627`, open a draft PR for the branch, and hand off for review or any follow-up feedback.
- Verification gap: `npm run build` first failed locally with `sh: 1: tsc: not found`; restored dev dependencies via `npm install` and reran successfully.
- Files touched: `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, `src/supervisor/supervisor-diagnostics-issue-lint-readiness.test.ts`, `src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would collapse the readiness and metadata scenarios back into a single broad issue-lint module, undoing the narrowed coverage this issue requires.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint-readiness.test.ts src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Split issue-lint readiness coverage into `src/supervisor/supervisor-diagnostics-issue-lint-readiness.test.ts` and missing-sections/metadata coverage into `src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`, leaving only the high-risk ambiguity case in `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`. Focused verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint-readiness.test.ts src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build` after restoring local dependencies with `npm install`.
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
