# Issue #669: Model routing: add explicit local-review model routing config

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/669
- Branch: codex/issue-669
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3a05f5aee3bb9365aafab70d66736e9727ed4b5f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T22:10:13.225Z

## Latest Codex Summary
- Added optional local-review model routing config for generic reviewer turns, pushed commit `29830ff` to `codex/issue-669`, and opened draft PR #674 (`https://github.com/TommyKammy/codex-supervisor/pull/674`).

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #669 only needs config and policy wiring right now. The narrow missing behavior is that generic local-review turns cannot opt into a different model from the main supervisor execution model, because all local-review turns currently inherit the single global `codexModelStrategy` / `codexModel`.
- What changed: added optional `localReviewModelStrategy` / `localReviewModel` config fields, taught `resolveCodexExecutionPolicy(...)` about explicit generic-local-review routing targets, and wired reviewer turns through that target while leaving specialist and verifier local-review turns on the main execution model. Added focused coverage in `src/core/config-local-review-model-routing.test.ts` and `src/codex/codex-policy.test.ts`, plus updated the shipped example config.
- Current blocker: none
- Next exact step: watch draft PR #674 for CI or review feedback and respond if any failures or comments arrive.
- Verification gap: none for the scoped issue work. Focused config and routing tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`. A broad `src/config.test.ts` run still reports an unrelated pre-existing README assertion about a missing `## Provider Profiles` heading.
- Files touched: `src/core/config.ts`, `src/core/types.ts`, `src/core/config-local-review-model-routing.test.ts`, `src/codex/codex-policy.ts`, `src/codex/codex-policy.test.ts`, `src/local-review/runner.ts`, `src/local-review/execution.ts`, `supervisor.config.example.json`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the explicit generic local-review model-routing surface and force reviewer turns back onto the main execution model, blocking the staged rollout planned in #668.
- Last focused command: `git push -u origin codex/issue-669`; `gh pr create --draft --base main --head codex/issue-669 --title "Add explicit local-review model routing config" ...`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-669` and opened draft PR #674 after landing checkpoint commit `29830ff` (`Add explicit generic local-review model routing config`).
- 2026-03-20 (JST): Reproduced #669 as a missing config/policy seam: generic local-review reviewer turns could not route independently from the main execution model. Added optional `localReviewModelStrategy` / `localReviewModel`, limited the override to generic reviewer turns, added focused config and policy tests, restored local deps with `npm install`, and passed `npx tsx --test src/core/config-local-review-model-routing.test.ts`, `npx tsx --test src/codex/codex-policy.test.ts`, and `npm run build`. A broader `src/config.test.ts` run still fails on an unrelated README heading assertion.
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851k4pw` as a real boundedness bug in `doctorCheckForLoadFindings(...)`; capped rendered finding details to five entries with a deterministic omission summary, added a focused oversized-SQLite regression in `src/doctor.test.ts`, and passed `npx tsx --test src/doctor.test.ts` plus `npm run build`.
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
