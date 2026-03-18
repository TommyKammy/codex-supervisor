# Issue #568: Getting started docs: add cross-links to the new agent bootstrap docs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/568
- Branch: codex/issue-568
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b2d3448de538c77dfebff64e86fecdf7641d5391
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T18:38:42.006Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `docs/getting-started.md` and `docs/getting-started.ja.md` lacked explicit handoffs to the new agent bootstrap docs, so a narrow getting-started docs regression should fail until both operator guides link to the matching `agent-instructions` doc without duplicating bootstrap protocol content.
- What changed: extended `src/getting-started-docs.test.ts` to require the English and Japanese agent bootstrap links; updated both getting-started guides to point AI operators at the matching `agent-instructions` doc from the intro/related-docs sections while keeping the pages focused on human operator flow.
- Current blocker: none
- Next exact step: monitor draft PR #587 for CI or review feedback and only make further changes if a concrete docs-flow or build issue appears.
- Verification gap: none beyond the focused getting-started/agent-instructions doc regressions and required build; no broader suite was needed for this docs-only slice.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/getting-started.md`, `docs/getting-started.ja.md`, `src/getting-started-docs.test.ts`
- Rollback concern: reverting this change would remove the explicit AI bootstrap handoff from both operator guides and drop the regression that keeps those cross-links present.
- Last focused command: `npx tsx --test src/getting-started-docs.test.ts`; `npx tsx --test src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Committed the getting-started/bootstrap cross-link slice as `bb1cdc8`, pushed `codex/issue-568`, and opened draft PR #587 (`https://github.com/TommyKammy/codex-supervisor/pull/587`).
- 2026-03-19 (JST): Reproduced issue #568 by tightening `src/getting-started-docs.test.ts` so the English and Japanese getting-started guides must link to `docs/agent-instructions.md` and `docs/agent-instructions.ja.md`; the focused test failed because neither guide contained the new AI bootstrap handoff. Added the cross-links in the intro/related-docs sections of both guides while keeping bootstrap protocol detail delegated to the agent docs. Focused verification passed with `npx tsx --test src/getting-started-docs.test.ts` and `npx tsx --test src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`; `npm run build` initially failed because `tsc` was missing locally, so restored dev dependencies with `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Reproduced issue #562 by extending `src/agent-instructions-docs.test.ts` with a Japanese bootstrap alignment check; it failed with `ENOENT` because `docs/agent-instructions.ja.md` did not exist. Added the Japanese bootstrap hub with mirrored section order and canonical links to `getting-started.ja.md`, `getting-started.md`, `configuration.md`, `issue-metadata.md`, and `local-review.md`. Focused verification passed with `npx tsx --test src/agent-instructions-docs.test.ts src/getting-started-docs.test.ts`; `npm run build` initially failed because `tsc` was missing locally, so restored dev dependencies with `npm install` and reran `npm run build` successfully.
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
