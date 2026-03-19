# Issue #605: Supervisor-selection-status refactor: slim supervisor-selection-status.ts into a thin facade

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/605
- Branch: codex/issue-605
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: df727d4d6bcd2505e11ab67ca31cf5f1c1287f32
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T02:35:57.851Z

## Latest Codex Summary
- Kept `src/supervisor/supervisor-selection-status.ts` as the public compatibility shim while aligning internal usage and focused tests with the extracted diagnostics modules. Added a facade contract test, pointed `Supervisor` directly at `supervisor-selection-issue-lint.ts`, and reran the focused diagnostics suite plus `npm run build` after restoring missing local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining cleanup for issue #605 is boundary enforcement, not more behavior refactoring, because `src/supervisor/supervisor-selection-status.ts` is already small enough to act as a pure facade and the operator-facing diagnostics output is covered by the extracted module tests.
- What changed: added `src/supervisor/supervisor-selection-status.test.ts` to assert the facade re-exports the dedicated active-status, readiness-summary, issue-explain, issue-lint, and status-record modules; updated `src/supervisor/supervisor.ts` to import `buildIssueLintSummary(...)` directly from `src/supervisor/supervisor-selection-issue-lint.ts` instead of the facade; and reran the focused diagnostics selection tests plus `npm run build`.
- Current blocker: none
- Next exact step: commit this issue-605 facade-alignment checkpoint and, if no additional review feedback appears locally, prepare or update the draft PR for the branch.
- Verification gap: none for the local slice; the focused facade and diagnostics tests passed, and `npm run build` passed after resolving the local missing-`tsc` environment with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-selection-status.test.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting this checkpoint would reintroduce an internal dependency on the compatibility facade and remove the guard that keeps `supervisor-selection-status.ts` constrained to re-exports.
- Last focused command: `npx tsx --test src/supervisor/supervisor-selection-status.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-selection-issue-lint.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): For issue #605, added a focused facade contract test for `supervisor-selection-status.ts` and switched `Supervisor` to import the issue-lint implementation directly so the facade remains a compatibility shim. Focused diagnostics tests passed. `npm run build` initially failed with `sh: 1: tsc: not found`, so restored local dev dependencies with `npm install` and reran the build successfully.
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
