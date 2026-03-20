# Issue #678: Status visibility: surface a compact local-review model routing summary

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/678
- Branch: codex/issue-678
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0d3d5a4ae4f5b32ac16663d067461579cb6eaef0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T00:51:34.027Z

## Latest Codex Summary
- Added a compact `local_review_routing` status summary sourced from the saved local-review artifact so operators can see whether generic reviewer roles ran on `gpt-5.4-mini` or inherited routing without opening the artifact. Focused status tests cover both an explicit mini-routed case and an inherited-routing case, and `npm run build` passes after restoring local dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `status` can stay compact by adding one artifact-backed `local_review_routing` line that aggregates routing by generic roles, specialist roles, and verifier, while labeling when generic routing inherits the main model path instead of using an explicit override such as `gpt-5.4-mini`.
- What changed: reproduced the missing visibility with focused `buildLocalReviewRoutingStatusLine(...)` regressions in `src/supervisor/supervisor-status-rendering.test.ts`, then implemented the summary in `src/supervisor/supervisor-status-rendering.ts` and threaded it through `src/supervisor/supervisor-selection-active-status.ts`, `src/supervisor/supervisor-status-model.ts`, and `src/supervisor/supervisor.ts`.
- Current blocker: none
- Next exact step: monitor draft PR #681 for review feedback or merge-readiness changes.
- Verification gap: none for the scoped issue verification. `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts` and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `src/supervisor/supervisor-selection-active-status.test.ts`, `src/supervisor/supervisor-selection-active-status.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor-status-rendering.test.ts`, `src/supervisor/supervisor-status-rendering.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the new compact routing visibility from `status`, forcing operators back to opening local-review artifacts to confirm whether generic reviewer turns used `gpt-5.4-mini` or inherited routing.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-678` to `origin/codex/issue-678` and opened draft PR #681 (`https://github.com/TommyKammy/codex-supervisor/pull/681`) after the focused status tests and `npm run build` were green locally.
- 2026-03-20 (JST): Reproduced issue #678 with focused status-rendering regressions for explicit `gpt-5.4-mini` generic routing and inherited generic routing, then added an artifact-backed `local_review_routing` summary line to status output. Focused verification passed with `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts`, and `npm run build` passed after `npm install` restored missing `tsc`.
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
