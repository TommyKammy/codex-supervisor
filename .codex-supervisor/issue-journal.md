# Issue #680: CodeRabbit review wait: re-arm latest-head provider waiting after post-review head advances

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/680
- Branch: codex/issue-680
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bc2cc9165be37a864ba2b77930005b4254132fa2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T01:16:44.011Z

## Latest Codex Summary
- Reproduced the stale-head CodeRabbit wait bug with a focused `inferStateFromPullRequest(...)` regression, then fixed latest-head merge gating so older CodeRabbit activity no longer satisfies provider waiting after `review_wait_started_at` is re-armed for a newer head. Added an unchanged-head guard test, reran the focused pull-request-state/lifecycle/review-signal suites, restored missing local dev dependencies with `npm install`, `npm run build` passed, and opened draft PR #686.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: latest-head merge gating should keep waiting when `review_wait_started_at` has been re-armed for a newer head but every actionable CodeRabbit signal still predates that re-arm point, because those older signals belong to earlier review activity.
- What changed: reproduced the bug with a focused latest-head regression plus an unchanged-head control in `src/pull-request-state-coderabbit-settled-waits.test.ts`, then added `shouldWaitForConfiguredBotLatestHeadRearm(...)` in `src/pull-request-state.ts` so stale pre-rearm CodeRabbit activity no longer satisfies waiting on the newer head.
- Current blocker: none
- Next exact step: monitor draft PR #686 for review feedback or CI changes, and address any review/status follow-up if CodeRabbit or CI surfaces a gap in the latest-head re-arm behavior.
- Verification gap: none for the scoped issue verification. `npx tsx --test src/pull-request-state-coderabbit-settled-waits.test.ts`, `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts --test-name-pattern "CodeRabbit"`, `npx tsx --test src/github/github-review-signals.test.ts --test-name-pattern "CodeRabbit|current-head|stale-head"`, and `npm run build` passed after `npm install` restored missing `tsc`.
- Files touched: `src/pull-request-state-coderabbit-settled-waits.test.ts`, `src/pull-request-state.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would let older CodeRabbit review activity satisfy merge gating for a newer PR head once the head advances past an earlier review.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-680` to `origin/codex/issue-680` and opened draft PR #686 (`https://github.com/TommyKammy/codex-supervisor/pull/686`) after the focused pull-request-state/lifecycle/review-signal tests and `npm run build` were green locally.
- 2026-03-20 (JST): Reproduced issue #680 with a focused latest-head CodeRabbit wait regression in `src/pull-request-state-coderabbit-settled-waits.test.ts`; the stale-head case incorrectly returned `stabilizing` instead of `waiting_ci` after the PR head advanced beyond an earlier CodeRabbit review. Fixed it in `src/pull-request-state.ts` by re-arming latest-head waiting whenever all actionable CodeRabbit signals predate `review_wait_started_at` for the current head, added an unchanged-head control test, reran the focused pull-request-state/lifecycle/review-signal suites, restored local dev dependencies with `npm install`, and reran `npm run build` successfully.
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
