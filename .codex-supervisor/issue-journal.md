# Issue #684: Reconciliation visibility: surface when the run lock is held for reconciliation work

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/684
- Branch: codex/issue-684
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 251c591973b43c9a2ae96467fba2caee1d9bc548
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T13:28:43+09:00

## Latest Codex Summary
- Annotated denied supervisor run-lock acquisitions with reconciliation context so skipped `run-once` cycles now distinguish reconciliation ownership from generic active lock ownership.
- Added focused regressions for the reconciliation-held run-lock message in `src/supervisor/supervisor-diagnostics-status-selection.test.ts` and the runtime skip output in `src/cli/supervisor-runtime.test.ts`.
- Restored missing local dev dependencies with `npm install`, then reran the focused tests and `npm run build` successfully.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is to keep the existing transient reconciliation marker and only augment the denied supervisor run-lock reason when that marker is present, leaving the lock lifecycle and scheduler behavior unchanged.
- What changed: updated `Supervisor.acquireSupervisorLock(...)` to append `for reconciliation work (<phase>)` when the run lock is already held and `.codex-supervisor/current-reconciliation-phase.json` exists, then added a focused supervisor regression for that case plus a runtime skip-output regression that preserves the operator-facing message shape.
- Current blocker: none
- Next exact step: commit the issue-684 checkpoint, then open or update the draft PR for this branch.
- Verification gap: none for the scoped issue work. `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build` passed locally after `npm install`.
- Files touched: `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`, `package-lock.json`
- Rollback concern: reverting this checkpoint makes skipped cycles fall back to a generic run-lock message again, obscuring that the lock holder is the supervisor’s reconciliation pass rather than active Codex work.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-671` to `origin/codex/issue-671` and opened draft PR #676 (`https://github.com/TommyKammy/codex-supervisor/pull/676`) after the focused artifact/finalize/result/status/policy tests and `npm run build` were already green locally.
- 2026-03-20 (JST): Pushed `codex/issue-660` and opened draft PR #667 (`https://github.com/TommyKammy/codex-supervisor/pull/667`) after the focused doctor/state-store verification and build had already passed locally.
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851kRrS` as a real bug: malformed SQLite rows could yield only `load_findings`, after which `loadFromSqlite()` returned fallback empty/bootstrap state without those findings. Fixed the fallback path, added a dedicated regression for the empty-state case, and reran `npx tsx --test src/core/state-store.test.ts` plus `npm run build` successfully.
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
