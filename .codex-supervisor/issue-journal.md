# Issue #601: Supervisor-selection-status refactor: extract active-status snapshot helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/601
- Branch: codex/issue-601
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 8cade09bf4b2663f967a39640577b3a68abb70bf
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T00:48:53.079Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #601 is satisfied because active-status snapshot loading and status-record summarization now live in dedicated modules, leaving `supervisor-selection-status.ts` focused on readiness, explain, and lint assembly.
- What changed: added `src/supervisor/supervisor-selection-active-status.ts` and `src/supervisor/supervisor-selection-status-records.ts`, moved `loadActiveIssueStatusSnapshot(...)` and `summarizeSupervisorStatusRecords(...)` into those modules, rewired `src/supervisor/supervisor.ts` and the focused helper tests to the new boundaries, and kept `src/supervisor/supervisor-selection-status.ts` as the explain/readiness/lint owner with compatibility re-exports.
- Current blocker: none
- Next exact step: commit the active-status helper extraction on `codex/issue-601`, then open or update the draft PR if one is not already present.
- Verification gap: none for the local refactor slice; focused supervisor status tests and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-selection-active-status.ts`, `src/supervisor/supervisor-selection-status-records.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-selection-status-active-status.test.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting this split would move active-status snapshot loading and record summarization back into `supervisor-selection-status.ts`, restoring the broader catch-all file shape without changing status behavior.
- Last focused command: `npx tsx --test src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #601 by adding focused helper coverage for `summarizeSupervisorStatusRecords(...)` and `loadActiveIssueStatusSnapshot(...)`; the first active-status assertion failed because the test workspace was not a git repo with an `origin/main...HEAD` diff, so I tightened the fixture into a real temporary git workspace and corrected the verification-intensity expectation to `focused`. Extracted the helpers into `supervisor-selection-active-status.ts` and `supervisor-selection-status-records.ts`, kept compatibility re-exports in `supervisor-selection-status.ts`, rerouted `supervisor.ts` to the narrower modules, and verified with `npx tsx --test src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts` plus `npm run build` after `npm install`.
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
