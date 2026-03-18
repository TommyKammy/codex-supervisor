# Issue #575: Issue authoring diagnostics: emit copy-pastable repair guidance from issue lint

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/575
- Branch: codex/issue-575
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d99ee5434066d3b056cc9d9961765588d8fa3ce9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T21:40:57.240Z

## Latest Codex Summary
- Added deterministic `repair_guidance_<n>=...` lines to `issue-lint` so missing structure, invalid metadata, and blocking ambiguity findings each emit copy-pastable repair instructions.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `issue-lint` findings are still higher-friction than necessary because authors can see what is wrong but do not get deterministic, copy-pastable repair text for missing sections, bad metadata, or high-risk ambiguity.
- What changed: added focused `issue-lint` regressions for one missing-section case, one metadata case, and one auth ambiguity case; then extended `buildIssueLintSummary(...)` to append deterministic `repair_guidance_<n>=...` lines derived from the existing readiness, metadata, and ambiguity results.
- Current blocker: none
- Next exact step: commit the repair-guidance slice, open or update the branch PR, and watch CI/review feedback.
- Verification gap: none; `src/issue-metadata/issue-metadata.test.ts`, `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, and `npm run build` all passed after restoring local dependencies with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`
- Rollback concern: reverting this change would remove the operator-facing repair path from `issue-lint`, forcing authors to reverse-engineer the lint rules again even though detection remains available.
- Last focused command: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #575 with a focused `issue-lint` regression: reports for missing required sections, malformed scheduling metadata, and unresolved auth ambiguity emitted only raw findings and no repair instructions. Fixed it by adding deterministic `repair_guidance_<n>=...` lines to `buildIssueLintSummary(...)`, ordering blocking ambiguity guidance ahead of recommended metadata hygiene, and verifying with `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` plus `npm run build` after restoring local dependencies via `npm install`.
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
