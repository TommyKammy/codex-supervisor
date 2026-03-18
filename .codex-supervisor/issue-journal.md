# Issue #574: Issue authoring diagnostics: report high-risk blocking ambiguity in issue lint

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/574
- Branch: codex/issue-574
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dc6963022cbe2b13e063b245759a80383b66039c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T19:57:45.582Z

## Latest Codex Summary
- Reproduced issue #574 with a focused `issue-lint` regression: lint output for both runnable risky auth work and explicit high-risk ambiguity cases had no ambiguity-specific diagnostic line, even though runtime selection already used `findHighRiskBlockingAmbiguity(...)` to stop on clarification blockers. Fixed `buildIssueLintSummary(...)` to emit a distinct `high_risk_blocking_ambiguity=` line, added focused coverage for both the normal risky case and the blocking ambiguity case, committed the change as `d8766f5`, and opened draft PR #590.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `issue-lint` currently misses the same high-risk blocking ambiguity that runtime execution already treats as a clarification stop because the lint summary only reports readiness and metadata syntax.
- What changed: added a focused `issue-lint` reproducer for one concrete risky auth issue and one unresolved-choice auth issue, then wired `buildIssueLintSummary(...)` to reuse `findHighRiskBlockingAmbiguity(...)` and emit `high_risk_blocking_ambiguity=<reason|none>` as a distinct operator-visible line.
- Current blocker: none
- Next exact step: watch draft PR #590 for CI and review feedback, then respond if any failures or review findings appear.
- Verification gap: none; `src/issue-metadata/issue-metadata.test.ts`, `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, and `npm run build` all passed after restoring local dependencies with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-diagnostics-issue-lint.test.ts`
- Rollback concern: reverting this change would put `issue-lint` back out of sync with runtime clarification stops, so operators would miss authored high-risk ambiguity until selection time.
- Last focused command: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Committed the lint ambiguity diagnostic change as `d8766f5` (`Report blocking ambiguity in issue lint`), pushed `codex/issue-574`, and opened draft PR #590 (`https://github.com/TommyKammy/codex-supervisor/pull/590`).
- 2026-03-19 (JST): Reproduced issue #574 with a focused `issue-lint` regression by asserting a new `high_risk_blocking_ambiguity=` line for both a concrete risky auth issue and an unresolved-choice auth issue. The initial failure was that lint output stopped at `metadata_errors=...` and never surfaced ambiguity. Fixed `buildIssueLintSummary(...)` to reuse `findHighRiskBlockingAmbiguity(...)`, reran `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`, then restored missing local TypeScript tooling with `npm install` and reran `npm run build`, all passing.
- 2026-03-19 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851RTo3` as a real gap: the zero/blank scheduling test did not include `Execution order:`, and `validateIssueMetadataSyntax(...)` used `/^\\s*Execution order:\\s*.+$/im`, which skipped blank values. Fixed the gate to match blank execution-order lines, added the missing regression coverage, and reran `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` plus `npm run build`, all passing.
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
