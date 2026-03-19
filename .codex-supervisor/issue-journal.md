# Issue #672: Model routing: add guarded support for mini on bounded repair states

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/672
- Branch: codex/issue-672
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5f82b6a80f35467c0ce34ac7a7ae1fc385f7c754
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T23:38:39.503Z

## Latest Codex Summary
- Added explicit bounded-repair model routing so `repairing_ci` and `addressing_review` can opt into a smaller model without changing default supervisor routing for broader implementation states.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded repair-state mini support should be an explicit config opt-in that applies only to supervisor turns in `repairing_ci` and `addressing_review`, leaving broader implementation states on the default GPT-5.4 path.
- What changed: reproduced the gap with a focused `resolveCodexExecutionPolicy(...)` regression, then added optional `boundedRepairModelStrategy` / `boundedRepairModel` config parsing and validation plus repair-state-only routing in `src/codex/codex-policy.ts`. Updated shipped example configs and configuration docs to surface the new opt-in.
- Current blocker: none
- Next exact step: commit this bounded-repair routing checkpoint, then push `codex/issue-672` and open a draft PR if one does not already exist.
- Verification gap: none in the scoped worktree. Focused policy/config/repair-state prompt tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `src/core/types.ts`, `src/core/config.ts`, `src/codex/codex-policy.ts`, `src/codex/codex-policy.test.ts`, `src/core/config-local-review-model-routing.test.ts`, `docs/configuration.md`, `docs/examples/atlaspm.md`, `docs/examples/atlaspm.supervisor.config.example.json`, `supervisor.config.example.json`, `supervisor.config.codex.json`, `supervisor.config.copilot.json`, `supervisor.config.coderabbit.json`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the only explicit way to route bounded repair turns to a smaller model while keeping broader implementation states on the default model policy.
- Last focused command: `npx tsx --test src/codex/codex-policy.test.ts`; `npx tsx --test src/core/config-local-review-model-routing.test.ts`; `npx tsx --test src/codex/codex-prompt.test.ts --test-name-pattern "repairing_ci|addressing_review"`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced issue #672 with a focused `src/codex/codex-policy.test.ts` regression where `boundedRepairModelStrategy: "alias"` plus `boundedRepairModel: "gpt-5.4-mini"` still left `repairing_ci` on `gpt-5-codex`. Fixed it by adding optional bounded repair config parsing/validation and repair-state-only routing, then reran focused policy/config/repair-state prompt tests and `npm run build` successfully after `npm install`.
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
