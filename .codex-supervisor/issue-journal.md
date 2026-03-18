# Issue #561: Docs bootstrap: add an English agent bootstrap protocol

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/561
- Branch: codex/issue-561
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6fb209fb912329a3f97d33bb4102c64c957181b2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T17:22:40.614Z

## Latest Codex Summary
- Added `docs/agent-instructions.md` as an English bootstrap hub for AI agents, backed by a focused docs regression and local build verification.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The missing English bootstrap hub can be fixed safely by adding one focused doc and a narrow regression that proves the file exists, stays ordered as a bootstrap protocol, and delegates detailed rules to the existing canonical references.
- What changed: added `src/agent-instructions-docs.test.ts` to require `docs/agent-instructions.md` with bootstrap-specific headings plus links to `getting-started.md`, `configuration.md`, `issue-metadata.md`, and `local-review.md`; reproduced the issue with an `ENOENT` failure because the doc did not exist; added `docs/agent-instructions.md` with prerequisites, read order, first-run sequence, escalation rules, and canonical-reference links while keeping detailed policy delegated to the existing docs.
- Current blocker: none
- Next exact step: review the generated doc text once more for wording drift, then commit this docs-only checkpoint and open or update the draft PR if needed.
- Verification gap: no full test suite run; this slice was verified with focused docs tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/agent-instructions.md`, `src/agent-instructions-docs.test.ts`
- Rollback concern: removing the new hub or its regression would reintroduce a missing first-read protocol for AI agents and make the docs bootstrap requirement easy to regress.
- Last focused command: `npx tsx --test src/agent-instructions-docs.test.ts`; `npx tsx --test src/agent-instructions-docs.test.ts src/getting-started-docs.test.ts`; `npm install`; `npm run build`
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
