# Issue #633: Supervisor regression: stale stabilizing already-satisfied-on-main issue does not converge to the expected manual stop

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/633
- Branch: codex/issue-633
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d298bd01c42b25b5a7482592e704d513aa16081b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T11:57:24.166Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the stale `stabilizing` no-PR loop only converges for recoverable tracked work today; already-satisfied-on-`origin/main` branches need an explicit branch-convergence classification so the existing `#591` manual-stop path triggers instead of requeueing again.
- What changed: added a focused reconciliation regression in `src/supervisor/supervisor-recovery-reconciliation.test.ts` for the already-satisfied-on-main stale `stabilizing` no-PR path, extended `reconcileStaleActiveIssueReservation(...)` with an injected branch-state classifier, and wired `Supervisor` to classify a stale no-PR worktree as `already_satisfied_on_main` only when `git diff origin/<default>...HEAD` and `git status --short` show no meaningful changes beyond the local issue journal. That path now preserves the existing `stale-stabilizing-no-pr-recovery-loop` signature and converges directly to the same explicit manual stop.
- Current blocker: none
- Next exact step: commit this focused stale-recovery fix, then open or update the draft PR with the reconciliation regression and the already-satisfied-on-main manual-stop path.
- Verification gap: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts` passed and `npm run build` passed after restoring missing dev dependencies with `npm install`. The requested `npm test -- src/supervisor/supervisor-recovery-reconciliation.test.ts` still runs the repository’s full suite and fails on unrelated baseline tests in docs/family-layout/run-once orchestration coverage.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore the stale already-satisfied-on-main loop, causing no-PR `stabilizing` records to requeue instead of stopping explicitly.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm install`; `npm test -- src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
### Scratchpad
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
