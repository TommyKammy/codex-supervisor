# Issue #684: Reconciliation visibility: surface when the run lock is held for reconciliation work

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/684
- Branch: codex/issue-684
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: ea71639acd0c6648d98a7611c4d6769692617599
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851oXRU
- Repeated failure signature count: 1
- Updated at: 2026-03-20T04:58:47.000Z

## Latest Codex Summary
Validated CodeRabbit thread `PRRT_kwDORgvdZ851oXRU` as a real regression in [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-684/src/supervisor/supervisor.ts): denied run-lock checks could now throw if reading the reconciliation phase marker hit a non-`ENOENT` filesystem error. I changed `Supervisor.acquireSupervisorLock(...)` to return the original denied lock immediately when no reason is available, and to fall back to the original denial if `readCurrentReconciliationPhase(...)` throws. I added a focused regression in [src/supervisor/supervisor-diagnostics-status-selection.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-684/src/supervisor/supervisor-diagnostics-status-selection.test.ts) that mocks an `EACCES` reconciliation-phase read failure while the run lock is already held.

The updated verification passed locally with `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`. The worktree still has a pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: hardened reconciliation-held run-lock messaging so denied lock reads fall back cleanly on reconciliation marker I/O failures
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ851oXRU
Next action: commit the review fix, push `codex/issue-684`, and resolve the CodeRabbit thread on PR #691

## Active Failure Context
- Category: review
- Summary: Local fix prepared for the remaining automated review thread; branch still needs an updated commit pushed to PR #691.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/691#discussion_r2963918105
- Details:
  - Fixed locally in `Supervisor.acquireSupervisorLock(...)` by returning early when the denied lock has no reason and by catching non-benign reconciliation-phase read failures so the original lock denial reason is preserved. Added focused regression coverage for an injected `EACCES` read failure on `.codex-supervisor/current-reconciliation-phase.json`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe review fix is to keep the reconciliation-held run-lock message behavior, but ensure reconciliation-phase marker reads never turn a normal lock denial into an exception path.
- What changed: `Supervisor.acquireSupervisorLock(...)` now returns the original denied lock immediately when no reason is available and catches thrown reconciliation-phase read failures so the denial reason stays intact; added focused status-selection coverage for a mocked `EACCES` read failure while the lock is already held.
- Current blocker: none
- Next exact step: commit the review fix, push `codex/issue-684`, and reply on PR #691 that the lock-denial fallback is now resilient to reconciliation marker read failures.
- Verification gap: none for this review-fix slice. `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build` passed locally.
- Files touched: `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would reintroduce the risk that a transient reconciliation marker read failure converts a routine skipped cycle into an exception path.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`
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
