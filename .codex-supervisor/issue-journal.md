# Issue #673: Supervisor bug: stale run lock with ambiguous owner metadata can stall the loop indefinitely

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/673
- Branch: codex/issue-673
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 51df7847d59b0582b7dac8aa5e3c30abe4ebe89b
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851m5DV
- Repeated failure signature count: 1
- Updated at: 2026-03-20T00:33:05.902Z

## Latest Codex Summary
Validated the remaining CodeRabbit thread as a real documentation issue in tracked journal content: the active failure context copied the review body verbatim, which kept machine-local absolute links in the repository even though the authored summary had already moved on.

I replaced that verbatim dump with a compact repository-relative summary in `.codex-supervisor/issue-journal.md` and refreshed the handoff so the journal no longer republishes broken local-path links.

Summary: Rewrote the journal's stored review context to avoid machine-local links and refreshed the handoff for the active review fix.
State hint: local_review_fix
Blocked reason: none
Tests: focused `rg` scan confirming no machine-local absolute path prefix remains in `.codex-supervisor/issue-journal.md`
Failure signature: PRRT_kwDORgvdZ851m5DV
Next action: commit the journal-only review fix, push `codex/issue-673`, and resolve the remaining PR thread

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/679#discussion_r2963412325
- Details:
  - CodeRabbit flagged machine-local links that had been introduced in the journal's earlier summary text and recommended repository-relative references such as `src/core/lock.ts`, `src/supervisor/supervisor.ts`, `src/lock.test.ts`, and `.codex-supervisor/issue-journal.md`.
  - The authored summary no longer contains those absolute links, but the journal was still preserving them by embedding the review body verbatim. This turn narrows the stored context to a summary so tracked content no longer republishes broken local-path links.

## Codex Working Notes
### Current Handoff
- Hypothesis: the supervisor run lock should be allowed to reclaim a dead-pid lock even when host/owner metadata is ambiguous, while generic issue/session locks should keep refusing ambiguous-owner cleanup.
- What changed: reproduced the stale run-lock gap with a focused `acquireFileLock(..., { allowAmbiguousOwnerCleanup: true })` regression in `src/lock.test.ts`, then added an explicit `AcquireFileLockOptions` override in `src/core/lock.ts` and used it only from `Supervisor.acquireSupervisorLock(...)` in `src/supervisor/supervisor.ts`.
- Current blocker: none
- Next exact step: commit the journal-only review fix, push the updated branch, and resolve the remaining CodeRabbit thread on PR #679.
- Verification gap: none for the scoped issue verification. `npx tsx --test src/lock.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/doctor.test.ts` and `npm run build` passed after restoring local dev dependencies with `npm install`. No additional verification was needed after pushing/opening the draft PR. Note: repo-wide `npm test -- ...` still executes the full suite and fails on unrelated pre-existing assertions in `README`/runtime-layout/turn-orchestration tests.
- Files touched: `src/core/lock.ts`, `src/lock.test.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore the indefinite skip loop for a dead ambiguous supervisor run lock, while generic ambiguous-owner protections for issue/session locks would remain unchanged.
- Last focused command: focused `rg` scan confirming no machine-local absolute path prefix remains in `.codex-supervisor/issue-journal.md`
### Scratchpad
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
