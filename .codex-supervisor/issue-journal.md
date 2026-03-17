# Issue #489: Test cleanup: split supervisor PR lifecycle coverage by readiness and review-blocker boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/489
- Branch: codex/issue-489
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-489
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-489/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9704168f31e53da4a7139911a933b74613c5ca4c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T15:54:52.619Z

## Latest Codex Summary
- Split `src/supervisor/supervisor-pr-lifecycle.test.ts` into readiness and review-blocker suites, preserved the legacy file as a thin import facade, and re-verified the focused supervisor PR lifecycle tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #489 can stay behavior-neutral by splitting `supervisor-pr-lifecycle.test.ts` into one readiness/post-turn suite and one review-blocker/thread-reprocessing suite, with the legacy path preserved as a facade import for existing test entry points.
- What changed: extracted readiness coverage into `src/supervisor/supervisor-pr-readiness.test.ts`, moved review-blocker and configured-bot thread reprocessing coverage into `src/supervisor/supervisor-pr-review-blockers.test.ts`, and reduced `src/supervisor/supervisor-pr-lifecycle.test.ts` to a thin facade import file.
- Current blocker: none
- Next exact step: Commit the suite split on `codex/issue-489`, then push/open the draft PR if one still does not exist.
- Verification gap: none for the split PR lifecycle suites or `npm run build`; `npm ci` was required first because `tsc` was initially unavailable locally.
- Files touched: `src/supervisor/supervisor-pr-lifecycle.test.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`, `src/supervisor/supervisor-pr-review-blockers.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would put readiness transitions, post-turn PR refresh, configured-bot thread reprocessing, and manual/local review blockers back into a single 915-line suite, making failures harder to localize.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18: Focused reproducer for #489 was `npx tsx --test src/supervisor/supervisor-pr-lifecycle.test.ts`, which passed before the split and confirmed the cleanup was behavior-neutral rather than a failing behavior fix.
- 2026-03-18: Verification for #489 was `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`, `npx tsx --test src/supervisor/supervisor-pr-lifecycle.test.ts`, then `npm ci` and `npm run build`; `npm run build` first failed with `sh: 1: tsc: not found` before dependencies were restored.
- 2026-03-18: `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun of `npm run build` passed.
- 2026-03-17: Review repair for PR #497 updates the guardrail provenance fixtures so committed shared-memory files are added before `headSha` is captured; focused verification was `npx tsx --test src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts` and `npm run build`.
- 2026-03-17: Added `draftSkipAt` to configured-bot summaries and hydrated PRs; focused verification was `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts`, followed by `npm ci` and `npm run build`.
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
