# Issue #596: Replay-corpus refactor: extract promotion helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/596
- Branch: codex/issue-596
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 78338fb6d9dc317ca6fcb2c75ab8cda2f77a979a
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851UWEj
- Repeated failure signature count: 1
- Updated at: 2026-03-18T23:42:59.798Z

## Latest Codex Summary
Validated CodeRabbit thread `PRRT_kwDORgvdZ851UWEj` against the current branch and confirmed the provider-wait hint could be emitted when `configuredBotCurrentHeadObservedAt` was omitted entirely. Fixed [`replay-corpus-promotion-summary.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-596/src/supervisor/replay-corpus-promotion-summary.ts) to require a non-nullish observation timestamp before it counts as a provider-wait signal, unless `copilotReviewState` is explicitly present, and added a focused regression in [`replay-corpus-promotion.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-596/src/supervisor/replay-corpus-promotion.test.ts) for the missing-field case.

The first new test assertion failed because the shared fixture still carried `timeout_retry_count=1`; I tightened the fixture overrides so the regression isolates only the provider-wait branch. The existing prebuild/build pipeline and the focused promotion suite passed locally. The only remaining worktree noise is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Fixed the provider-wait promotion hint to ignore missing configured-bot observations, added a focused regression, and revalidated the promotion test file plus build
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts` (failed once due to fixture retry defaults, then passed after isolating the provider-wait branch); `npm run build`
Failure signature: PRRT_kwDORgvdZ851UWEj
Next action: Commit and push the review fix on `codex/issue-596`, then resolve CodeRabbit thread `PRRT_kwDORgvdZ851UWEj`

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/606#discussion_r2956874754
- Details:
  - src/supervisor/replay-corpus-promotion-summary.ts:79 _⚠️ Potential issue_ | _🟡 Minor_ **Don't let `undefined` trigger `provider-wait`.** Line 77 currently treats a missing `configuredBotCurrentHeadObservedAt` as a positive signal because `undefined !== null`. That can add a false `provider-wait` hint for snapshots that have `currentHeadCiGreenAt` but no configured-bot observation recorded. <details> <summary>Suggested fix</summary> ```diff - (pullRequest.configuredBotCurrentHeadObservedAt !== null || - pullRequest.copilotReviewState !== undefined) + ((pullRequest.configuredBotCurrentHeadObservedAt !== undefined && + pullRequest.configuredBotCurrentHeadObservedAt !== null) || + pullRequest.copilotReviewState !== undefined) ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/replay-corpus-promotion-summary.ts` around lines 68 - 79, The condition incorrectly treats missing configuredBotCurrentHeadObservedAt (undefined) as present because undefined !== null is true; update the composite check in the if to require configuredBotCurrentHeadObservedAt to be neither null nor undefined (e.g., use both !== null and !== undefined or an explicit != null check) before using it as a positive signal, so change the clause (pullRequest.configuredBotCurrentHeadObservedAt !== null || pullRequest.copilotReviewState !== undefined) to ((pullRequest.configuredBotCurrentHeadObservedAt !== null && pullRequest.configuredBotCurrentHeadObservedAt !== undefined) || pullRequest.copilotReviewState !== undefined) referencing pullRequest.configuredBotCurrentHeadObservedAt and pullRequest.copilotReviewState in the file replay-corpus-promotion-summary.ts. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining risk in this PR slice was the provider-wait hint overcounting missing configured-bot observations; the local fix should fully cover that path because the helper now treats `configuredBotCurrentHeadObservedAt` as present only when it is non-nullish, and the focused regression exercises the previously false-positive combination.
- What changed: updated `src/supervisor/replay-corpus-promotion-summary.ts` so the provider-wait hint only considers `configuredBotCurrentHeadObservedAt` when it is neither `null` nor `undefined`, and added a focused missing-observation regression to `src/supervisor/replay-corpus-promotion.test.ts` while preserving the earlier extracted promotion-helper split.
- Current blocker: none
- Next exact step: commit and push this review fix, then reply on PR #606 that the false-positive provider-wait case is covered locally.
- Verification gap: none for the review fix; `npm run build` passed, and `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts` passed after one initial regression-authoring failure caused by fixture retry defaults.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus-promotion-summary.ts`, `src/supervisor/replay-corpus-promotion.test.ts`
- Rollback concern: reverting this narrow fix would reintroduce a false-positive promotion hint path for snapshots that omit `configuredBotCurrentHeadObservedAt`, which would make replay corpus promotions noisier without reflecting real supervisor state.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851UWEj` by changing the provider-wait promotion hint guard to use a non-nullish check for `configuredBotCurrentHeadObservedAt` and adding a focused regression for the missing-field case. The first new assertion failed because the shared snapshot fixture still emitted `retry-escalation` via `timeout_retry_count=1`; after zeroing the retry counters in the test setup, `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts` passed and `npm run build` remained green.
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
