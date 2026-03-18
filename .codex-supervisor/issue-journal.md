# Issue #573: Issue authoring diagnostics: validate dependency and sequencing metadata syntax and local consistency in issue lint

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/573
- Branch: codex/issue-573
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7a48c0368bb7ad47c198b16ed5f5305a262b4ed7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T19:16:28.605Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `issue-lint` already enforced required sections for a single authored issue, but it still ignored malformed or self-inconsistent dependency/sequencing metadata, so a focused invalid-metadata regression should fail until the lint summary validates those fields locally.
- What changed: added `validateIssueMetadataSyntax(...)` for local `Part of`, `Depends on`, `Execution order`, and `Parallelizable` checks; surfaced a deterministic `metadata_errors=` line from `buildIssueLintSummary(...)`; and tightened focused issue-lint plus issue-metadata tests to cover both valid and invalid metadata cases.
- Current blocker: none
- Next exact step: commit this checkpoint on `codex/issue-573`, then open or update the draft PR so CI can validate the new metadata diagnostics end to end.
- Verification gap: none beyond broader CLI coverage if a reviewer asks for it; focused issue-metadata and issue-lint tests plus `npm run build` pass locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/issue-metadata/issue-metadata-validation.ts`, `src/issue-metadata/issue-metadata.ts`, `src/issue-metadata/issue-metadata.test.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`
- Rollback concern: reverting this change would make `issue-lint` silently accept malformed dependency/sequencing metadata again, leaving authors to discover scheduler metadata errors only at runtime selection.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #573 with a focused `issue-lint` regression: an authored issue containing `Part of: #104`, duplicate/self `Depends on`, `Execution order: 3 of 2`, and `Parallelizable: Later` still reported `execution_ready=yes` and no metadata problems. Fixed it by adding local metadata validation and a `metadata_errors=` summary line, then verified with `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build` after restoring local deps via `npm install`.
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
