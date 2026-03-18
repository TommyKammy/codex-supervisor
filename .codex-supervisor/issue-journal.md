# Issue #567: README.ja: add a Japanese AI handoff entry while keeping the landing page lightweight

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/567
- Branch: codex/issue-567
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c273432a896ea37fe9ad3bd9961a8a6c1c9c2060
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T18:20:12.667Z

## Latest Codex Summary
- Reproduced the missing Japanese AI handoff with a focused `src/readme-docs.test.ts` regression, then updated `docs/README.ja.md` to keep the landing page lightweight while routing humans to `docs/getting-started.ja.md` and AI agents to `docs/agent-instructions.ja.md`. Focused docs tests and `npm run build` now pass.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `docs/README.ja.md` lacked an explicit AI bootstrap pointer, so a narrow README doc-flow regression should fail until the Japanese landing page names `docs/agent-instructions.ja.md` while still keeping the human getting-started route visible.
- What changed: extended `src/readme-docs.test.ts` with a Japanese landing-page regression that locks section order and requires both the human getting-started link and the AI agent handoff link; updated `docs/README.ja.md` to add the AI handoff entry in the intro, overview, quick-start handoff, and docs map while keeping the page overview-oriented.
- Current blocker: none
- Next exact step: monitor draft PR #586 for review or CI signals and only make further changes if a concrete doc-flow or build failure appears.
- Verification gap: none beyond the focused README/doc-flow regressions and required build; no broader suite was needed for this docs-only slice.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/README.ja.md`, `src/readme-docs.test.ts`
- Rollback concern: reverting this change would drop the explicit Japanese AI bootstrap entry and remove the regression that guards the lightweight landing-page routing.
- Last focused command: `npx tsx --test src/readme-docs.test.ts`; `npx tsx --test src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Committed the Japanese README handoff slice as `54ccb3a`, pushed `codex/issue-567`, and opened draft PR #586 (`https://github.com/TommyKammy/codex-supervisor/pull/586`).
- 2026-03-19 (JST): Reproduced issue #567 by extending `src/readme-docs.test.ts` with a Japanese landing-page regression; it failed because `docs/README.ja.md` linked humans to `docs/getting-started.ja.md` but never routed AI agents to `docs/agent-instructions.ja.md`. Updated the lightweight Japanese overview to point humans to the getting-started guide and AI agents to the bootstrap hub in the intro, overview, quick-start handoff, and docs map. Focused verification passed with `npx tsx --test src/readme-docs.test.ts`, `npx tsx --test src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
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
