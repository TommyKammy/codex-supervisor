# Issue #493: External-review cleanup: refine durable guardrail and regression-candidate boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/493
- Branch: codex/issue-493
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-493
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-493/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 365427b2402cc4000cfe3d41647dfad22d689fd8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T17:18:00.937Z

## Latest Codex Summary
- Extracted shared regression-candidate qualification from the external-review durable guardrail module, kept durable promotion shaping separate from regression payload shaping, added a focused qualification test, and re-verified the external-review candidate/persistence suites plus `npm run build` after restoring the local toolchain with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the durable guardrail family stays behavior-neutral if regression eligibility is qualified in one focused helper, with `external-review-durable-guardrail-candidates.ts` responsible only for durable promotion shaping/provenance and `external-review-regression-candidates.ts` responsible only for regression payload shaping.
- What changed: added `src/external-review/external-review-regression-candidate-qualification.test.ts` as the focused reproducer for the shared regression boundary, extracted `qualifyRegressionCandidateFinding` into `src/external-review/external-review-regression-candidate-qualification.ts`, updated `external-review-regression-candidates.ts` to build persisted regression candidates from that helper, and updated `external-review-durable-guardrail-candidates.ts` to derive its `regression_test` durable category from the same qualification path while preserving its existing deterministic output/provenance shape.
- Current blocker: none
- Next exact step: Commit the regression-boundary cleanup on `codex/issue-493`, then check whether the branch already has a PR before opening or updating a draft PR.
- Verification gap: none for the focused durable-guardrail/regression suites or `npm run build`; `npm ci` was required first because `tsc` was initially unavailable locally in this worktree.
- Files touched: `src/external-review/external-review-durable-guardrail-candidates.ts`, `src/external-review/external-review-regression-candidate-qualification.ts`, `src/external-review/external-review-regression-candidate-qualification.test.ts`, `src/external-review/external-review-regression-candidates.ts`, `.codex-supervisor/issue-journal.md`, `package-lock.json`, `node_modules/`
- Rollback concern: reverting this cleanup would put the regression qualification bar back in two separate modules, making future learning-loop changes more likely to drift between durable promotion and regression payload generation.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18: Focused reproducer for #493 was a missing shared regression-qualification seam; `external-review-regression-candidate-qualification.test.ts` locked the regression bar to review-thread, missed-by-local-review, non-low-severity, high-confidence, file-scoped, line-scoped findings without asserting durable-only title/provenance shaping.
- 2026-03-18: Verification for #493 was `npx tsx --test src/external-review/external-review-regression-candidate-qualification.test.ts src/external-review/external-review-regression-candidates.test.ts src/external-review/external-review-durable-guardrail-candidates.test.ts src/external-review/external-review-miss-persistence.test.ts` and `npm run build`; `npm run build` first failed with `sh: 1: tsc: not found`, then `npm ci` restored the local toolchain and both commands passed.
- 2026-03-17: Pushed `codex/issue-478` to `origin` and opened draft PR #481 (`https://github.com/TommyKammy/codex-supervisor/pull/481`) after confirming there was no existing PR for the branch.
- 2026-03-17: Review repair for PR #481 adds the same per-bot removal guard to `draftSkipAt` that rate-limit warnings already used, plus a regression test for stale draft-skip comments after request removal.
- 2026-03-17: Cleaned the copied review-context links in this journal so they use repository-relative markdown targets instead of local `/home/...` paths.
- 2026-03-17: Repair verification for the stale draft-skip fix was `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts` and `npm run build`, both passing before commit `e7c4170`.
- 2026-03-17: Focused reproducer for #480 was `inferStateFromPullRequest` returning `ready_to_merge` instead of `waiting_ci` when `review_wait_started_at=2026-03-13T02:30:00Z`, `configuredBotDraftSkipAt=2026-03-13T02:25:00Z`, `currentHeadCiGreenAt=2026-03-13T02:05:00Z`, and no fresh CodeRabbit signal had arrived after ready-for-review.
- 2026-03-17: The fix reuses the refreshed review-wait window after ready-for-review for CodeRabbit draft-skip cases, but only until either `configuredBotInitialGraceWaitSeconds` expires or a newer actionable configured-bot signal arrives (`configuredBotCurrentHeadObservedAt`, `copilotReviewArrivedAt`, or `configuredBotTopLevelReviewSubmittedAt`).
- 2026-03-17: Verification for #480 was `npx tsx --test src/pull-request-state-provider-waits.test.ts src/supervisor/supervisor-lifecycle.test.ts`; `npm run build` initially failed with `sh: 1: tsc: not found`, then `npm ci` restored the toolchain and both the focused tests and `npm run build` passed.
- 2026-03-17: Re-ran `npx tsx --test src/pull-request-state-provider-waits.test.ts src/supervisor/supervisor-lifecycle.test.ts` and `npm run build`, both passing before pushing `codex/issue-480` and opening draft PR #482 (`https://github.com/TommyKammy/codex-supervisor/pull/482`).
- 2026-03-17: Review repair for PR #482 filters malformed configured-bot timestamps before selecting the latest actionable signal; focused regression/verification was `npx tsx --test src/pull-request-state-provider-waits.test.ts` and `npm run build`.
- 2026-03-17: Follow-up review repair for PR #482 updates the live journal summary links from absolute `/home/...` targets to repository-relative `../src/...` paths so CodeRabbit readers can open them from the repo view.
- 2026-03-17: Pushed `9a7289c` (`Use repo-relative journal links`) to `origin/codex/issue-480` and resolved CodeRabbit thread `PRRT_kwDORgvdZ850206I` with `gh api graphql`.
- 2026-03-17: Focused reproducer for #477 was status still emitting `configured_bot_initial_grace_wait pause_reason=awaiting_initial_provider_activity recent_observation=required_checks_green` after ready-for-review when `review_wait_started_at=2026-03-13T02:30:00Z`, `configuredBotDraftSkipAt=2026-03-13T02:25:00Z`, and no fresh CodeRabbit signal had arrived since the draft skip.
- 2026-03-17: Status fix for #477 keys the draft-skip re-wait off `review_wait_started_at`/`review_wait_head_sha`, reuses the configured initial grace duration, and surfaces it distinctly as `pause_reason=awaiting_fresh_provider_review_after_draft_skip` with `recent_observation=ready_for_review_reopened_wait`.
- 2026-03-17: Verification for #477 was `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build` first failed with `sh: 1: tsc: not found`, then `npm ci` restored the local toolchain and both the focused tests and `npm run build` passed.
