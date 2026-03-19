# Issue #602: Supervisor-selection-status refactor: extract issue-lint diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/602
- Branch: codex/issue-602
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: fd9e85e10bcdc0dc8e3818d44426accc659070fa
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T01:12:00.000Z

## Latest Codex Summary
- Extracted issue-lint diagnostics and repair guidance into `src/supervisor/supervisor-selection-issue-lint.ts`, added focused helper-level coverage, preserved compatibility re-exports from `supervisor-selection-status.ts`, and verified with focused issue-lint tests plus `npm run build` after restoring local dependencies via `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue-lint already had a stable cohesive boundary, so moving `buildIssueLintSummary(...)` and its repair-guidance rules into a dedicated module should shrink `supervisor-selection-status.ts` without changing diagnostics output.
- What changed: added `src/supervisor/supervisor-selection-issue-lint.ts`, moved the issue-lint summary builder and repair-guidance helpers there, kept compatibility re-exports in `src/supervisor/supervisor-selection-status.ts`, and added focused helper coverage in `src/supervisor/supervisor-selection-issue-lint.test.ts` alongside the existing end-to-end supervisor diagnostics test.
- Current blocker: none
- Next exact step: commit the issue-lint extraction on `codex/issue-602`, then open or update a draft PR if one is not already present.
- Verification gap: none for the local refactor slice; focused issue-lint tests and `npm run build` passed after resolving the temporary missing-`tsc` environment via `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-selection-issue-lint.ts`, `src/supervisor/supervisor-selection-issue-lint.test.ts`, `src/supervisor/supervisor-selection-status.ts`
- Rollback concern: reverting this split would move issue-lint diagnostics and repair guidance back into `supervisor-selection-status.ts`, recreating the broader mixed-responsibility file without changing lint semantics.
- Last focused command: `npx tsx --test src/supervisor/supervisor-selection-issue-lint.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #602 by adding focused helper-level coverage for `buildIssueLintSummary(...)`, then extracted the issue-lint summary builder and repair guidance into `src/supervisor/supervisor-selection-issue-lint.ts` with compatibility re-exports from `src/supervisor/supervisor-selection-status.ts`. `npm run build` initially failed with `sh: 1: tsc: not found`, so restored local dependencies with `npm install` and reran focused verification successfully with `npx tsx --test src/supervisor/supervisor-selection-issue-lint.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build`.
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
