# Issue #659: State-store visibility: capture structured corruption findings during load

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/659
- Branch: codex/issue-659
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: da75c36d11b8727307590021748c9349c204e514
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T20:12:23.514Z

## Latest Codex Summary
- Added focused state-store regressions for representative JSON and SQLite parse corruption during load, then updated the loader to return structured `load_findings` while preserving the existing empty-state / row-drop fallback behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is to attach an optional structured corruption-finding array to the loaded state object, omitting it when empty so unaffected load behavior and existing consumers stay stable.
- What changed: inspected `src/core/state-store.ts`, `src/core/state-store.test.ts`, `src/core/types.ts`, and `src/doctor.ts` to confirm that JSON syntax errors only warned and returned empty state while malformed SQLite rows only warned and were dropped. Added focused regressions in `src/core/state-store.test.ts` for one invalid JSON state file and one malformed SQLite issue row. The new tests failed first because `StateStore.load()` returned the prior fallback state without any structured corruption payload. Updated `src/core/types.ts` with optional `StateLoadFinding`/`load_findings` typing and updated `src/core/state-store.ts` so JSON load syntax failures return empty state plus one `load_findings` entry, while SQLite row parse failures still skip the bad row but now capture a per-row finding alongside the loaded state. Preserved the current `console.warn(...)` behavior and fallback semantics. Restored local dev dependencies with `npm install` because `npm run build` initially failed with `sh: 1: tsc: not found`, then reran the focused state-store tests and build successfully.
- Current blocker: none
- Next exact step: commit the focused state-store corruption-finding slice on `codex/issue-659`, then open a draft PR if one does not exist yet.
- Verification gap: none for the stated issue scope; I ran the focused `src/core/state-store.test.ts` slice plus `npm run build`, but not the full repository test suite because the issue calls for focused state-store verification and build only.
- Files touched: `src/core/types.ts`, `src/core/state-store.ts`, `src/core/state-store.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would drop structured visibility for JSON load corruption and malformed SQLite rows, returning those cases to warn-only behavior.
- Last focused command: `git status --short --branch`; `rg -n "corruption|finding|state-store|sqlite|JSON|parse" src .`; `sed -n '1,320p' src/core/state-store.ts`; `sed -n '1,360p' src/core/state-store.test.ts`; `sed -n '1,280p' src/core/types.ts`; `npx tsx --test src/core/state-store.test.ts`; `npm install`; `npm run build`
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
