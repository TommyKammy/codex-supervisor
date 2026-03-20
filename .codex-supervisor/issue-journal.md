# Issue #685: Reconciliation visibility: emit a conservative warning for unusually long reconciliation cycles

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/685
- Branch: codex/issue-685
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f17fe52b1717d6522ef1ad7369d7ee5432827c34
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T05:00:48.774Z

## Latest Codex Summary
- Reproduced the missing long-reconciliation visibility with a focused `status` regression, then fixed it by persisting reconciliation cycle start time in the phase snapshot and emitting a non-blocking `reconciliation_warning=long_running ...` line once the cycle exceeds a five-minute threshold. Focused diagnostics coverage and `npm run build` now pass locally after restoring missing dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix for #685 is to keep reconciliation visibility on the existing `status` path by preserving each reconciliation cycle's start time in the phase snapshot and warning only when that cycle exceeds a conservative threshold.
- What changed: `writeCurrentReconciliationPhase(...)` now preserves a `startedAt` timestamp across phase updates, `Supervisor.status()` emits a non-blocking `reconciliation_warning=long_running ...` line once the active cycle exceeds five minutes, and `src/supervisor/supervisor-diagnostics-status-selection.test.ts` now covers both the fresh-cycle no-warning case and the long-cycle warning case.
- Current blocker: none
- Next exact step: commit the reconciliation warning slice, push `codex/issue-685`, and open a draft PR because this branch now has a coherent checkpoint.
- Verification gap: none for this slice. `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build` passed locally after `npm install` restored the missing `typescript` dependency in this worktree.
- Files touched: `src/supervisor/supervisor-reconciliation-phase.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the only operator-visible signal for reconciliation cycles that stay active far longer than normal while still holding the run loop open.
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
