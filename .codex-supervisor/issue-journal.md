# Issue #596: Replay-corpus refactor: extract promotion helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/596
- Branch: codex/issue-596
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 687355fa2e9658f02243d1fbfa8a00b997e095b2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-18T23:45:06.000Z

## Latest Codex Summary
Validated CodeRabbit thread `PRRT_kwDORgvdZ851UWEj` against the current branch and confirmed the provider-wait hint could be emitted when `configuredBotCurrentHeadObservedAt` was omitted entirely. Fixed [`replay-corpus-promotion-summary.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-596/src/supervisor/replay-corpus-promotion-summary.ts) to require a non-nullish observation timestamp before it counts as a provider-wait signal, unless `copilotReviewState` is explicitly present, and added a focused regression in [`replay-corpus-promotion.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-596/src/supervisor/replay-corpus-promotion.test.ts) for the missing-field case.

The first new test assertion failed because the shared fixture still carried `timeout_retry_count=1`; I tightened the fixture overrides so the regression isolates only the provider-wait branch. The existing prebuild/build pipeline and the focused promotion suite passed locally. I committed the fix as `687355f`, pushed `codex/issue-596`, and resolved the CodeRabbit thread on PR #606. The only remaining worktree noise is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Fixed the provider-wait promotion hint false positive, added a focused regression, pushed `687355f`, and resolved the CodeRabbit thread on PR #606
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts` (failed once due to fixture retry defaults, then passed after isolating the provider-wait branch); `npm run build`
Failure signature: none
Next action: Watch PR #606 for any follow-up review feedback or CI regressions after commit `687355f`

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining risk in this PR slice was the provider-wait hint overcounting missing configured-bot observations; the local fix should fully cover that path because the helper now treats `configuredBotCurrentHeadObservedAt` as present only when it is non-nullish, and the focused regression exercises the previously false-positive combination.
- What changed: updated `src/supervisor/replay-corpus-promotion-summary.ts` so the provider-wait hint only considers `configuredBotCurrentHeadObservedAt` when it is neither `null` nor `undefined`, and added a focused missing-observation regression to `src/supervisor/replay-corpus-promotion.test.ts` while preserving the earlier extracted promotion-helper split.
- Current blocker: none
- Next exact step: watch PR #606 for any new review comments or CI noise after the `687355f` push.
- Verification gap: none for the review fix; `npm run build` passed, and `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts` passed after one initial regression-authoring failure caused by fixture retry defaults.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus-promotion-summary.ts`, `src/supervisor/replay-corpus-promotion.test.ts`
- Rollback concern: reverting this narrow fix would reintroduce a false-positive promotion hint path for snapshots that omit `configuredBotCurrentHeadObservedAt`, which would make replay corpus promotions noisier without reflecting real supervisor state.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus-promotion.test.ts`; `npm run build`; `git push origin codex/issue-596`; `gh api graphql -f query='mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ851UWEj`
### Scratchpad
- 2026-03-19 (JST): Pushed review-fix commit `687355f` to `origin/codex/issue-596` and resolved CodeRabbit thread `PRRT_kwDORgvdZ851UWEj` via `gh api graphql` after the focused promotion test file and `npm run build` passed locally.
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
