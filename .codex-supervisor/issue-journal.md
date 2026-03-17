# Issue #494: External-review cleanup: align tests with the refined external-review module boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/494
- Branch: codex/issue-494
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-494
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-494/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7a140af41563ee414a3e1a85d3618e17378cc39a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T17:52:55.383Z

## Latest Codex Summary
- Tightened the external-review test boundaries around the extracted regression qualification helper, added a focused external-review family layout guard, updated the broad family directory expectation to the current runtime file set, and re-verified the focused external-review suites plus `npm run build` after restoring the local toolchain with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the external-review test family stays stable if qualification-boundary assertions live only with `external-review-regression-candidate-qualification`, payload-shaping assertions live only with `external-review-regression-candidates`, and a focused layout guard makes the refined external-review module/test boundaries explicit.
- What changed: added `src/external-review/external-review-family-layout.test.ts` to pin the external-review runtime/test file set, expanded `external-review-regression-candidate-qualification.test.ts` so it owns the regression-boundary rejections, narrowed `external-review-regression-candidates.test.ts` to payload shaping plus null-on-failed-qualification behavior, and updated `src/family-directory-layout.test.ts` to match the current root/external-review/supervisor runtime module lists.
- Current blocker: none
- Next exact step: Commit the external-review test-boundary cleanup on `codex/issue-494`, then check whether the branch already has a PR before opening or updating a draft PR.
- Verification gap: none for the focused external-review suites or `npm run build`; `npm ci` was required first because `tsc` was initially unavailable locally in this worktree.
- Files touched: `src/external-review/external-review-family-layout.test.ts`, `src/external-review/external-review-regression-candidate-qualification.test.ts`, `src/external-review/external-review-regression-candidates.test.ts`, `src/family-directory-layout.test.ts`, `.codex-supervisor/issue-journal.md`, `package-lock.json`, `node_modules/`
- Rollback concern: reverting this cleanup would blur the extracted regression qualification boundary again by leaving payload-shaping tests responsible for qualification behavior and by dropping the focused external-review layout guard.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18: Focused reproducer for #494 was `npx tsx --test src/family-directory-layout.test.ts`, which failed because the external-review runtime list still omitted `external-review-regression-candidate-qualification.ts` and related refined-boundary modules; the same stale layout guard also omitted current root/supervisor helper modules.
- 2026-03-18: Focused external-review verification for #494 was `npx tsx --test src/external-review/external-review-family-layout.test.ts src/external-review/external-review-regression-candidate-qualification.test.ts src/external-review/external-review-regression-candidates.test.ts src/external-review/external-review-durable-guardrail-candidates.test.ts`, passing after narrowing the regression-candidate suite back to payload shaping.
- 2026-03-18: `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the next `npm run build` passed.
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
