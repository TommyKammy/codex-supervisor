# Issue #484: Test cleanup: split pull-request-state provider-wait coverage by policy boundary

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/484
- Branch: codex/issue-484
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-484
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-484/.codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1134d2017fe57336a35e41aa6d70ba3b67b7aacb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T13:57:33Z

## Latest Codex Summary
- Split the combined provider-wait coverage into `src/pull-request-state-provider-wait-policy.test.ts` and `src/pull-request-state-coderabbit-settled-waits.test.ts`, preserving the existing 28 assertions while making the CodeRabbit settled/draft-skip boundary explicit.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the cleanup can stay behavior-neutral by moving the generic provider/Copilot wait policy and timeout assertions out of the combined file, leaving CodeRabbit settled-wait and draft-skip behavior in a dedicated suite.
- What changed: deleted `src/pull-request-state-provider-waits.test.ts`, moved provider-neutral wait/timeout coverage into `src/pull-request-state-provider-wait-policy.test.ts`, and moved CodeRabbit current-head, initial-grace, settled-wait, and draft-skip re-wait coverage into `src/pull-request-state-coderabbit-settled-waits.test.ts`.
- Current blocker: none
- Next exact step: Commit the test split on `codex/issue-484`, then open or update the draft PR if needed.
- Verification gap: none locally after restoring `node_modules` with `npm ci`.
- Files touched: `src/pull-request-state-provider-wait-policy.test.ts`, `src/pull-request-state-coderabbit-settled-waits.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would re-concentrate unrelated provider policy changes into one large test file, bringing back unnecessary churn around CodeRabbit-only edits.
- Last focused command: `npx tsx --test src/pull-request-state-provider-wait-policy.test.ts src/pull-request-state-coderabbit-settled-waits.test.ts`; `npm ci`; `npm run build`
### Scratchpad
- 2026-03-17: Focused baseline for #484 was `npx tsx --test src/pull-request-state-provider-waits.test.ts`, which passed with 28 assertions before the file split.
- 2026-03-17: Split provider wait coverage into `src/pull-request-state-provider-wait-policy.test.ts` and `src/pull-request-state-coderabbit-settled-waits.test.ts`; focused verification was `npx tsx --test src/pull-request-state-provider-wait-policy.test.ts src/pull-request-state-coderabbit-settled-waits.test.ts`, then `npm ci` and `npm run build`.
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
