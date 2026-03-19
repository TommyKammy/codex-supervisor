# Issue #643: Lock stale detection: add host and owner metadata to lock payloads

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/643
- Branch: codex/issue-643
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 06b3900e6879ab25981138bbab7b8aa0d4da91b1
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T15:08:57.595Z

## Latest Codex Summary
- Reproduced the missing lock metadata with a focused lock test, updated lock payloads to include compact `host` and `owner` fields while keeping legacy payload reading intact, and verified with `npx tsx --test src/lock.test.ts` plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale-lock interpretation should start by enriching the lock payload itself; adding deterministic `host` and `owner` strings is enough for this issue without changing acquisition or cleanup semantics.
- What changed: re-ran `git status --short --branch`, `rg --files -g '*lock*'`, `sed -n '1,200p' src/core/lock.ts`, and `sed -n '1,280p' src/lock.test.ts`; added focused coverage in `src/lock.test.ts` for newly written payload metadata and legacy payload compatibility. The new test initially failed because `payload.host` was `undefined`. Updated `src/core/lock.ts` to write `host: os.hostname()` and `owner` from `os.userInfo().username` with `USER`/`USERNAME` fallback, then reran `npx tsx --test src/lock.test.ts`. `npm run build` first failed with `sh: 1: tsc: not found`, so I restored dev dependencies via `npm install` and reran `npm run build` successfully.
- Current blocker: none
- Next exact step: commit the lock payload/test changes, push `codex/issue-643`, and open a draft PR so CI can validate the focused slice.
- Verification gap: none for the scoped acceptance criteria; I ran the focused lock test file and `npm run build`, but not the full repository test suite because this issue asks for focused verification plus build.
- Files touched: `src/core/lock.ts`, `src/lock.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would drop the new lock metadata fields and the compatibility regression coverage for legacy payloads.
- Last focused command: `git status --short --branch`; `rg --files -g '*lock*'`; `sed -n '1,200p' src/core/lock.ts`; `sed -n '1,280p' src/lock.test.ts`; `npx tsx --test src/lock.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #637 with focused `runCommand` failures that emitted 1.2k-character `stderr` payloads; initial tests failed because thrown non-zero and timeout errors included the full `stderr` body. Fixed `src/core/command.ts` so error messages splice oversized `stderr` with a deterministic middle ellipsis while preserving both the prefix and suffix, including the timeout marker appended at the end. Focused verification passed with `npx tsx --test src/core/command.test.ts` and `npm run build` after `npm install`.
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
