# Issue #562: Docs bootstrap: add a Japanese agent bootstrap protocol

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/562
- Branch: codex/issue-562
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a32c84f89fbfba423f8b33862f9ad03875c85b6e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T17:41:15.332Z

## Latest Codex Summary
- Added `docs/agent-instructions.ja.md` as a Japanese bootstrap hub for AI agents, backed by a focused alignment regression and local build verification; opened draft PR #584.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The Japanese bootstrap entry can be added safely by extending the existing docs regression to require a Japanese peer doc with the same section order and delegation role as the English hub, then translating only the bootstrap protocol while linking back to canonical references.
- What changed: extended `src/agent-instructions-docs.test.ts` with a focused Japanese alignment regression for `docs/agent-instructions.ja.md`; reproduced the issue with an `ENOENT` failure because the Japanese doc did not exist; added `docs/agent-instructions.ja.md` with the same bootstrap structure as the English hub, including prerequisites, read order, first-run sequence, escalation rules, and canonical-reference links to the existing docs.
- Current blocker: none
- Next exact step: monitor draft PR #584, review any doc-link feedback, and wait for CI or review signals before further changes.
- Verification gap: no broader suite run beyond the focused docs coverage and required build; this issue only changed docs and a doc regression.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/agent-instructions.ja.md`, `src/agent-instructions-docs.test.ts`
- Rollback concern: removing the Japanese bootstrap hub or its regression would reintroduce a missing deterministic first-read path for Japanese AI agents and allow English/Japanese bootstrap structure to drift.
- Last focused command: `npx tsx --test src/agent-instructions-docs.test.ts`; `npx tsx --test src/agent-instructions-docs.test.ts src/getting-started-docs.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Committed the verified docs slice as `1571ad1` (`Add Japanese agent bootstrap doc`), pushed `codex/issue-562`, and opened draft PR #584 (`https://github.com/TommyKammy/codex-supervisor/pull/584`).
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
