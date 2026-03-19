# Issue #604: Supervisor-selection-status refactor: extract readiness and selection-why summaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/604
- Branch: codex/issue-604
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0f3e463e9abf5eb47ccbd3753dee7c339497d175
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T02:06:03.016Z

## Latest Codex Summary
- Added focused direct coverage for readiness and selection-why summaries, extracted both summary builders into `src/supervisor/supervisor-selection-readiness-summary.ts`, kept compatibility re-exports in `src/supervisor/supervisor-selection-status.ts`, and reran focused tests plus `npm run build` after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: readiness and selection-why summary assembly can move into a dedicated scheduler-facing module without changing runnable/blocked formatting or selected-issue reasoning, as long as the same candidate/all-issue inputs and selection-reason formatter are preserved.
- What changed: added focused direct coverage in `src/supervisor/supervisor-selection-readiness-summary.test.ts`; extracted `buildReadinessSummary(...)`, `buildSelectionWhySummary(...)`, and the runnable-readiness formatter into new `src/supervisor/supervisor-selection-readiness-summary.ts`; kept compatibility re-exports in `src/supervisor/supervisor-selection-status.ts`; and pointed `src/supervisor/supervisor.ts` at the new module for scheduler-facing summary assembly.
- Current blocker: none
- Next exact step: commit the readiness-summary extraction checkpoint on `codex/issue-604`, then open or update the draft PR for issue #604 if one does not already exist.
- Verification gap: none for the local refactor slice; focused readiness/selection-status tests, focused issue-explain tests, and `npm run build` all passed after resolving the temporary missing-`tsc` environment via `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-selection-readiness-summary.test.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting this split would move scheduler-facing readiness and selection-why summary logic back into `supervisor-selection-status.ts`, re-mixing it with issue-diagnostics responsibilities without changing behavior.
- Last focused command: `npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts`; `npm run build`
### Scratchpad
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
