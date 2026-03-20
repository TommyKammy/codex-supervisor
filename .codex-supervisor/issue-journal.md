# Issue #673: Supervisor bug: stale run lock with ambiguous owner metadata can stall the loop indefinitely

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/673
- Branch: codex/issue-673
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: ffcfccbfd95db6c53ea98d1f21a882a0dfa5dc7b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T00:35:18.068Z

## Latest Codex Summary
Pushed `ffcfccb` (`Clean journal review context links`) to `origin/codex/issue-673` after validating the remaining CodeRabbit thread as a real journal-content issue. The fix replaces the verbatim review-body dump in the journal with a compact summary so the tracked file no longer republishes machine-local absolute links.

I also verified the review thread state via `gh api graphql` and resolved `PRRT_kwDORgvdZ851m5DV` once GitHub marked it outdated on the new head.

Summary: Pushed the journal-only review fix and resolved the remaining CodeRabbit thread on PR #679.
State hint: pr_open
Blocked reason: none
Tests: focused `rg` scan confirming no machine-local absolute path prefix remains in `.codex-supervisor/issue-journal.md`; `gh api graphql` thread-state query; `gh api graphql` `resolveReviewThread`
Failure signature: none
Next action: monitor PR #679 for any new review feedback or merge readiness changes

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the supervisor run lock should be allowed to reclaim a dead-pid lock even when host/owner metadata is ambiguous, while generic issue/session locks should keep refusing ambiguous-owner cleanup.
- What changed: reproduced the stale run-lock gap with a focused `acquireFileLock(..., { allowAmbiguousOwnerCleanup: true })` regression in `src/lock.test.ts`, then added an explicit `AcquireFileLockOptions` override in `src/core/lock.ts` and used it only from `Supervisor.acquireSupervisorLock(...)` in `src/supervisor/supervisor.ts`.
- Current blocker: none
- Next exact step: monitor PR #679 for any new review feedback or merge-readiness changes.
- Verification gap: none for the scoped issue verification. `npx tsx --test src/lock.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/doctor.test.ts` and `npm run build` passed after restoring local dev dependencies with `npm install`. No additional verification was needed after pushing/opening the draft PR. Note: repo-wide `npm test -- ...` still executes the full suite and fails on unrelated pre-existing assertions in `README`/runtime-layout/turn-orchestration tests.
- Files touched: `src/core/lock.ts`, `src/lock.test.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore the indefinite skip loop for a dead ambiguous supervisor run lock, while generic ambiguous-owner protections for issue/session locks would remain unchanged.
- Last focused command: `gh api graphql` `resolveReviewThread` for `PRRT_kwDORgvdZ851m5DV`
### Scratchpad
- 2026-03-20 (JST): Pushed `ffcfccb` (`Clean journal review context links`) to `origin/codex/issue-673`, confirmed the CodeRabbit thread was outdated on the new head, and resolved `PRRT_kwDORgvdZ851m5DV` via `gh api graphql`.
- 2026-03-20 (JST): Validated review thread `PRRT_kwDORgvdZ851m5DV` as a real journal-content issue, then replaced the verbatim comment dump in `.codex-supervisor/issue-journal.md` with a compact summary so the tracked file no longer republishes machine-local links.
- 2026-03-20 (JST): Pushed `codex/issue-673` to `origin/codex/issue-673` and opened draft PR #679 (`https://github.com/TommyKammy/codex-supervisor/pull/679`) after the scoped lock/recovery/doctor tests and `npm run build` were already green locally.
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
