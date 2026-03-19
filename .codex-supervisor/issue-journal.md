# Issue #671: Model routing: surface local-review model routing in operator-visible output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/671
- Branch: codex/issue-671
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d20bc2891d4df1655ca0edea5beceffdcfedad72
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T23:06:13.812Z

## Latest Codex Summary
- Surfaced effective local-review routing in the saved Markdown/JSON artifacts by deriving deterministic `target`, `model`, and `reasoningEffort` per role and verifier from the existing execution policy.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining issue-671 gap after #670 is visibility, not routing itself. Operators can now route generic local-review roles differently, but the saved local-review artifact never recorded which execution target/model path each role actually used.
- What changed: added deterministic routing derivation in `finalizeLocalReview(...)`, stored `routing={target,model,reasoningEffort}` on each artifact role report plus the verifier report, and added a `## Model routing` section to the Markdown artifact. Also narrowed `resolveCodexExecutionPolicy(...)` to the config fields it actually consumes so artifact routing can be derived without fake full-config casts.
- Current blocker: none
- Next exact step: commit the issue-671 artifact-routing visibility checkpoint on `codex/issue-671`, then open or update the draft PR and watch CI.
- Verification gap: none for the scoped issue work. Focused local-review artifact/finalize/result/status/policy tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `src/codex/codex-policy.ts`, `src/local-review/types.ts`, `src/local-review/finalize.ts`, `src/local-review/artifacts.ts`, `src/local-review/artifacts.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the only deterministic artifact record of which model path each local-review role and verifier actually used, forcing operators back to inference/guesswork after routing changes from #670.
- Last focused command: `npx tsx --test src/local-review/artifacts.test.ts src/local-review/finalize.test.ts src/local-review/result.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-rendering.test.ts src/codex/codex-policy.test.ts`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced issue #671 as a visibility gap: local-review artifacts exposed thresholds and summaries, but not the effective generic/specialist/verifier model path. Fixed it by deriving artifact routing from `resolveCodexExecutionPolicy(...)`, storing `routing={target,model,reasoningEffort}` in JSON, and adding a concise `## Model routing` section to the Markdown artifact. Focused verification passed with `npx tsx --test src/local-review/artifacts.test.ts src/local-review/finalize.test.ts src/local-review/result.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-rendering.test.ts src/codex/codex-policy.test.ts`; `npm run build` initially failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-20 (JST): Reproduced issue #670 with a focused `runRoleReview` regression: `docs_researcher` was classified as `local_review_specialist` instead of `local_review_generic`, while a specialist preservation check already passed. Fixed `reviewerTypeForRole(...)` by making the generic role set explicit (`reviewer`, `explorer`, `docs_researcher`), restored local dev dependencies with `npm install`, and passed `npx tsx --test src/local-review/runner.test.ts src/codex/codex-policy.test.ts`, `npx tsx --test src/core/config-local-review-model-routing.test.ts`, and `npm run build`.
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
