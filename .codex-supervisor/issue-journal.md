# Issue #680: CodeRabbit review wait: re-arm latest-head provider waiting after post-review head advances

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/680
- Branch: codex/issue-680
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 13369f1ef95885c2f4ab3eda2ecd270a07c60e19
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-20T01:41:52Z

## Latest Codex Summary
Repaired the failing Ubuntu CI gate for PR #686 after the latest-head CodeRabbit waiting change altered the checked-in replay corpus outcome for `stale-head-prevents-merge`. The replay case now consistently expects `waiting_ci`/`shouldRunCodex=false`, matching the new latest-head provider re-arm behavior already implemented in [src/pull-request-state.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-680/src/pull-request-state.ts).

I updated the checked-in replay fixture in [replay-corpus/cases/stale-head-prevents-merge/input/snapshot.json](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-680/replay-corpus/cases/stale-head-prevents-merge/input/snapshot.json) and [replay-corpus/cases/stale-head-prevents-merge/expected/replay-result.json](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-680/replay-corpus/cases/stale-head-prevents-merge/expected/replay-result.json), plus refreshed the handoff in [issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-680/.codex-supervisor/issue-journal.md). The only remaining local workspace dirt beyond tracked changes is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Reproduced the Ubuntu replay-corpus mismatch, updated the stale-head checked-in replay case to the intended `waiting_ci` latest-head wait outcome, and reran the failing replay gate plus focused latest-head/provider tests and build successfully.
State hint: repairing_ci
Blocked reason: none
Tests: `npx tsx src/index.ts replay-corpus`; `npx tsx --test src/pull-request-state-coderabbit-settled-waits.test.ts`; `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts --test-name-pattern "CodeRabbit"`; `npx tsx --test src/github/github-review-signals.test.ts --test-name-pattern "CodeRabbit|current-head|stale-head"`; `npx tsx --test src/supervisor/replay-corpus-runner.test.ts --test-name-pattern "checked-in PR lifecycle safety cases"`; `npm run build`
Failure signature: build (ubuntu-latest):fail
Next action: Monitor PR #686 checks after push `13369f1` and confirm the latest rerun clears the Ubuntu replay-corpus gate.

## Active Failure Context
- Category: checks
- Summary: PR #686 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/686
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23324989013/job/67844213270

## Codex Working Notes
### Current Handoff
- Hypothesis: latest-head merge gating should keep waiting when `review_wait_started_at` has been re-armed for a newer head but every actionable CodeRabbit signal still predates that re-arm point, because those older signals belong to earlier review activity.
- What changed: reproduced the failing Ubuntu CI command (`npx tsx src/index.ts replay-corpus`), confirmed the only mismatch was checked-in case `stale-head-prevents-merge`, and updated that replay corpus fixture so its embedded snapshot decision and expected replay result now match the intended `waiting_ci` outcome from the latest-head CodeRabbit re-arm logic.
- Current blocker: none
- Next exact step: monitor PR #686 checks for pushed head `13369f1` and confirm the latest Actions rerun clears the Ubuntu replay-corpus gate.
- Verification gap: none for the scoped CI repair. `npx tsx src/index.ts replay-corpus`, `npx tsx --test src/pull-request-state-coderabbit-settled-waits.test.ts`, `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts --test-name-pattern "CodeRabbit"`, `npx tsx --test src/github/github-review-signals.test.ts --test-name-pattern "CodeRabbit|current-head|stale-head"`, `npx tsx --test src/supervisor/replay-corpus-runner.test.ts --test-name-pattern "checked-in PR lifecycle safety cases"`, and `npm run build` all passed locally.
- Files touched: `replay-corpus/cases/stale-head-prevents-merge/expected/replay-result.json`, `replay-corpus/cases/stale-head-prevents-merge/input/snapshot.json`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would let older CodeRabbit review activity satisfy merge gating for a newer PR head once the head advances past an earlier review.
- Last focused command: `npx tsx src/index.ts replay-corpus`
### Scratchpad
- 2026-03-20 (JST): Investigated failing PR #686 Ubuntu build run `23324989013` / job `67844213270`; the failure was a replay-corpus mismatch in checked-in case `stale-head-prevents-merge`, which still expected `stabilizing` even though the latest-head CodeRabbit re-arm change now intentionally yields `waiting_ci`. Updated the case fixture, reran the replay gate plus focused CodeRabbit/replay tests, committed `8195bf2` (`Fix stale-head replay corpus expectation`), then committed `13369f1` to refresh the tracked journal handoff and pushed `codex/issue-680`; PR #686 now has a fresh pending check suite for the new head.
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
