# Issue #673: Supervisor bug: stale run lock with ambiguous owner metadata can stall the loop indefinitely

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/673
- Branch: codex/issue-673
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: c7c36fc812c80d0f8ab94669de606109370f2164
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T00:22:24.973Z

## Latest Codex Summary
Implemented the narrow run-lock recovery fix in [src/core/lock.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-673/src/core/lock.ts) and [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-673/src/supervisor/supervisor.ts). `acquireFileLock` now accepts an explicit `allowAmbiguousOwnerCleanup` override, and only the supervisor run lock uses it, so dead ambiguous run locks are reclaimed while ordinary issue/session locks keep the safer refusal path.

I added the focused reproducer in [src/lock.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-673/src/lock.test.ts) and updated the journal in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-673/.codex-supervisor/issue-journal.md). Commit: `c7c36fc` (`Fix stale ambiguous supervisor run locks`).

Summary: Narrow supervisor-only recovery for dead ambiguous run locks implemented and committed.
State hint: local_review
Blocked reason: none
Tests: `npx tsx --test src/lock.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npm install`; `npx tsx --test src/lock.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/doctor.test.ts`; `npm run build` (also observed unrelated pre-existing failures when `npm test -- ...` expanded to the full suite)
Failure signature: none
Next action: open or update a draft PR for issue #673 and let CI validate the scoped run-lock fix

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the supervisor run lock should be allowed to reclaim a dead-pid lock even when host/owner metadata is ambiguous, while generic issue/session locks should keep refusing ambiguous-owner cleanup.
- What changed: reproduced the stale run-lock gap with a focused `acquireFileLock(..., { allowAmbiguousOwnerCleanup: true })` regression in `src/lock.test.ts`, then added an explicit `AcquireFileLockOptions` override in `src/core/lock.ts` and used it only from `Supervisor.acquireSupervisorLock(...)` in `src/supervisor/supervisor.ts`.
- Current blocker: none
- Next exact step: watch CI on draft PR #679 and respond to any review feedback or failing checks.
- Verification gap: none for the scoped issue verification. `npx tsx --test src/lock.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/doctor.test.ts` and `npm run build` passed after restoring local dev dependencies with `npm install`. No additional verification was needed after pushing/opening the draft PR. Note: repo-wide `npm test -- ...` still executes the full suite and fails on unrelated pre-existing assertions in `README`/runtime-layout/turn-orchestration tests.
- Files touched: `src/core/lock.ts`, `src/lock.test.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore the indefinite skip loop for a dead ambiguous supervisor run lock, while generic ambiguous-owner protections for issue/session locks would remain unchanged.
- Last focused command: `git push -u origin codex/issue-673`; `gh pr create --draft --base main --head codex/issue-673 --title "Fix stale ambiguous supervisor run locks" --body ...`
### Scratchpad
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
