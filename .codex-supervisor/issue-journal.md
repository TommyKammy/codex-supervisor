# Issue #637: Command error hygiene: bound stderr included in failure and timeout errors

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/637
- Branch: codex/issue-637
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c1584f4769eb12fd00a16bed741fd5f196cd4d17
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T13:05:34.651Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is to bound only the `stderr` payload injected into thrown `runCommand(...)` timeout and non-zero-exit errors, leaving captured `stderr` unchanged on the success path.
- What changed: added focused `src/core/command.test.ts` coverage that reproduces noisy `stderr` for both non-zero exit and timeout failures, then updated `src/core/command.ts` to splice oversized `stderr` with a deterministic middle `...` marker before building the thrown error message.
- Current blocker: none
- Next exact step: commit this stderr-bounding slice on `codex/issue-637`, then decide whether to push and open a draft PR if none exists yet.
- Verification gap: `npx tsx --test src/core/command.test.ts` and `npm run build` passed locally after `npm install`; I did not run the repository-wide test suite because the issue asks for focused command-runner coverage plus build verification.
- Files touched: `src/core/command.ts`, `src/core/command.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore unbounded raw `stderr` blocks inside thrown timeout and non-zero-exit command errors.
- Last focused command: `npm install`; `npx tsx --test src/core/command.test.ts`; `npm run build`
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
