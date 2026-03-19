# Issue #644: Lock stale detection: distinguish ambiguous owner states during stale-lock inspection

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/644
- Branch: codex/issue-644
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6053bf454c7e0dd256bc41b39d871e674f5efa74
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T15:30:31.539Z

## Latest Codex Summary
- Reproduced issue #644 with focused lock and recovery tests, added explicit `stale` versus `ambiguous_owner` lock inspection states, kept clearly local dead-process cleanup working while blocking ambiguous-owner cleanup, verified with focused tests plus `npm run build`, committed `6128dbb`, pushed `codex/issue-644`, and opened draft PR #663.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: a dead lock should only auto-clean when its metadata proves it belongs to this exact host and owner; every other dead-owner case should stay explicit and block cleanup as `ambiguous_owner`.
- What changed: re-ran `git status --short --branch`, `rg --files -g '*lock*'`, `sed -n '1,260p' src/core/lock.ts`, `sed -n '1,320p' src/lock.test.ts`, and the recovery reconciliation tests. Added focused reproducers in `src/lock.test.ts` for a clearly stale local dead lock, an ambiguous remote-owner dead lock, and acquisition refusal for ambiguous-owner locks; the new assertions failed because `inspectFileLock(...)` returned `missing` and stale-reservation cleanup still cleared state for the ambiguous case. Updated `src/core/lock.ts` to return explicit `stale` and `ambiguous_owner` states, only remove clearly local stale locks, and refuse acquisition when a dead lock has ambiguous owner metadata. Updated `src/recovery-reconciliation.ts` so stale active-reservation cleanup only proceeds for `missing`/`stale` locks and leaves `ambiguous_owner` locks untouched, then added matching coverage in `src/supervisor/supervisor-recovery-reconciliation.test.ts`. `npm run build` first failed with `sh: 1: tsc: not found`, so I restored dev dependencies via `npm install`; a follow-up build failed on a nullable payload access in `src/core/lock.ts`, which I fixed before the final green rerun.
- Current blocker: none
- Next exact step: watch draft PR #663 for CI and review feedback, then respond with follow-up fixes if anything regresses.
- Verification gap: none for the issue scope; I ran the focused lock and stale-recovery tests plus `npm run build`, but not the full repository test suite because the issue asks for focused verification plus build.
- Files touched: `src/core/lock.ts`, `src/lock.test.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would collapse dead ambiguous-owner locks back into ordinary stale cleanup, allowing both acquisition and stale active-reservation recovery to silently remove locks that no longer prove local ownership.
- Last focused command: `git status --short --branch`; `rg --files -g '*lock*'`; `sed -n '1,260p' src/core/lock.ts`; `sed -n '1,320p' src/lock.test.ts`; `sed -n '160,520p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/lock.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm install`; `npx tsx --test src/lock.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
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
