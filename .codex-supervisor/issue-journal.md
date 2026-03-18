# Issue #557: Replay corpus promotion: suggest normalized case ids during promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/557
- Branch: codex/issue-557
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3b0f10d703f021c00194a52ed5998ce99dd70579
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T16:11:23.988Z

## Latest Codex Summary
- Added deterministic replay corpus case-id suggestions for promotion and surfaced them through the CLI when operators omit an explicit case id.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the replay promotion flow still forced operators to invent a case id from scratch, so the narrow missing behavior was deterministic, review-friendly suggestion output derived from the captured snapshot.
- What changed: added focused tests for deterministic case-id suggestions and for the CLI path where `replay-corpus-promote <snapshotPath>` surfaces suggestions without writing; implemented `suggestReplayCorpusCaseIds(...)` in `src/supervisor/replay-corpus.ts` and updated `src/index.ts` to print suggestions when `caseId` is omitted while preserving explicit case-id control for actual promotion writes.
- Current blocker: none
- Next exact step: commit this deterministic suggestion checkpoint, then open or update the draft PR for issue #557.
- Verification gap: broader full-suite verification has not been run beyond `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts` and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/index.ts`, `src/index.test.ts`, `src/supervisor/replay-corpus.ts`, `src/supervisor/replay-corpus.test.ts`
- Rollback concern: removing the missing-case-id suggestion path would restore the current friction where promotion requires inventing a manual case id before the tool can offer any normalized options.
- Last focused command: `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
