# Issue #572: Issue authoring diagnostics: add issue lint for required execution-ready sections

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/572
- Branch: codex/issue-572
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2f62e58325a0c047385a08d6fd95a34b80224aab
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T18:56:51.890Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the repo already had reusable execution-ready issue-body linting, but lacked a dedicated single-issue authoring diagnostic, so a narrow supervisor diagnostic test should fail until a focused `issue-lint` command reports required-section gaps deterministically for one target issue.
- What changed: added `Supervisor.issueLint(...)` plus `buildIssueLintSummary(...)`, wired a new `issue-lint <issueNumber>` CLI command, and added focused coverage for one complete issue, one incomplete issue, and `parseArgs(...)` support for the new command.
- Current blocker: none
- Next exact step: monitor draft PR #588 for CI or review feedback and only make further changes if a concrete diagnostics/output issue appears.
- Verification gap: none beyond the focused issue-metadata and issue-lint diagnostic coverage plus the required build.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/types.ts`, `src/index.test.ts`, `src/index.ts`, `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting this change would remove the dedicated single-issue authoring diagnostic and its focused regression coverage, pushing authors back to broader scheduler diagnostics only.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npx tsx --test src/index.test.ts --test-name-pattern "issue-lint|doctor as a command|replay-corpus|replay with a snapshot path|explain rejects malformed issue numbers"`; `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Pushed `codex/issue-572` and opened draft PR #588 (`https://github.com/TommyKammy/codex-supervisor/pull/588`) after the focused issue-lint slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #572 by adding `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; it failed with `TypeError: supervisor.issueLint is not a function`. Implemented `buildIssueLintSummary(...)`, added `Supervisor.issueLint(...)`, and wired the `issue-lint` CLI command plus `parseArgs(...)` coverage. Focused verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, `npx tsx --test src/index.test.ts --test-name-pattern "issue-lint|doctor as a command|replay-corpus|replay with a snapshot path|explain rejects malformed issue numbers"`, `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
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
