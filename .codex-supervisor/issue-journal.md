# Issue #558: Replay corpus promotion: print a compact reviewable summary after promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/558
- Branch: codex/issue-558
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e6ae5c1e2e3e6c2cd894fbf97f9878e90e2e8e23
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T16:42:16.441Z

## Latest Codex Summary
- Added compact replay-corpus promotion summary output to the CLI: successful promotion now prints the created case path, compact normalized expected outcome, and volatile-field normalization notes when the promotion rewrites those fields.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining gap for issue #558 was that `replay-corpus-promote` completed successfully but only printed a one-line success banner, so operators still had to open files manually to review the created case and normalized expected outcome.
- What changed: tightened the existing CLI promotion regression in `src/index.test.ts` to require `Case path`, `Expected outcome`, and `Normalization` lines; added `summarizeReplayCorpusPromotion(...)` plus an exported compact outcome formatter in `src/supervisor/replay-corpus.ts`; updated `src/index.ts` to print the compact promotion summary after a successful promotion.
- Current blocker: none
- Next exact step: commit this promotion-summary checkpoint on `codex/issue-558`, then decide whether to open/update the draft PR for the branch.
- Verification gap: no broader full-suite run yet; this slice was verified with focused CLI and replay-corpus tests plus `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/index.ts`, `src/index.test.ts`, `src/supervisor/replay-corpus.ts`
- Rollback concern: removing the new summary logic would regress operators back to the prior one-line success message, and broadening the normalization notes beyond changed fields would add noise to the review output.
- Last focused command: `npx tsx --test src/index.test.ts`; `npx tsx --test src/supervisor/replay-corpus.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
