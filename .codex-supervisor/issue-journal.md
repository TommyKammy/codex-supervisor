# Issue #492: External-review cleanup: separate miss persistence/state patching from miss-history loading

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/492
- Branch: codex/issue-492
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-492
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-492/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6d5213c6f8fadfa54fb20bbe10024782fa88068d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T16:35:29.871Z

## Latest Codex Summary
- Added a focused miss-artifact boundary test, extracted shared miss-artifact helpers into `src/external-review/external-review-miss-artifact.ts`, and narrowed `external-review-miss-history.ts` to historical loading/ordering while `external-review-miss-persistence.ts` keeps persistence and context creation. Focused miss suites and `npm run build` pass after `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #492 stays behavior-neutral by moving miss-artifact shaping and legacy pattern fallback into a shared artifact helper, leaving `external-review-miss-history.ts` focused on loading/ordering historical patterns and `external-review-miss-persistence.ts` focused on artifact persistence plus context creation.
- What changed: added `src/external-review/external-review-miss-artifact.test.ts` as the focused reproducer for artifact-pattern extraction, extracted `buildExternalReviewMissArtifact`, `createExternalReviewMissContext`, and `readExternalReviewMissArtifactPatterns` into `src/external-review/external-review-miss-artifact.ts`, updated `external-review-miss-history.ts` to consume the shared artifact reader, and updated `external-review-miss-persistence.ts` to consume the shared artifact/context builders instead of owning artifact shaping inline.
- Current blocker: none
- Next exact step: Commit the miss-artifact boundary cleanup on `codex/issue-492`, then check whether the branch already has a PR before opening or updating a draft PR.
- Verification gap: none for the focused miss suites or `npm run build`; `npm ci` was required first because `tsx`/`tsc` were initially unavailable locally in this worktree.
- Files touched: `src/external-review/external-review-miss-artifact.ts`, `src/external-review/external-review-miss-artifact.test.ts`, `src/external-review/external-review-miss-history.ts`, `src/external-review/external-review-miss-persistence.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would put legacy miss-pattern extraction back inside `external-review-miss-history.ts` and artifact/context shaping back inside `external-review-miss-persistence.ts`, widening future changes across loading and persistence paths again.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-17: Focused reproducer for #492 was `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-history.test.ts` initially failing with `Cannot find module './external-review-miss-artifact'` before the shared artifact helper existed.
- 2026-03-17: Verification for #492 was `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts src/external-review/external-review-miss-history.test.ts src/external-review/external-review-miss-state.test.ts` and `npm run build`, both passing after `npm ci`.
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
