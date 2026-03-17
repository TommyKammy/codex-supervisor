# Issue #487: Test cleanup: split supervisor recovery coverage by reconciliation and failure flows

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/487
- Branch: codex/issue-487
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-487
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-487/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 95a13947e1fe7973c2a3314d87bf708909d4a7be
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T14:13:46.856Z

## Latest Codex Summary
- Split the mixed supervisor recovery test coverage into dedicated reconciliation and failure-flow suites, leaving `src/supervisor/supervisor-recovery.test.ts` as a thin facade that imports both focused files. Focused recovery tests and `npm run build` pass after restoring the local toolchain with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #487 can stay behavior-neutral by moving the recovery reconciliation assertions into their own focused suite and isolating dirty-worktree/unexpected-failure recovery flows in a separate file, with the original test path kept only as a facade import.
- What changed: split `src/supervisor/supervisor-recovery.test.ts` into `src/supervisor/supervisor-recovery-reconciliation.test.ts` and `src/supervisor/supervisor-recovery-failure-flows.test.ts`, and reduced `src/supervisor/supervisor-recovery.test.ts` to two side-effect imports.
- Current blocker: none
- Next exact step: Review the split diff for any import-path or test-discovery concerns, then commit the cleanup on `codex/issue-487`.
- Verification gap: none locally after rerunning the focused recovery suites and `npm run build`.
- Files touched: `src/supervisor/supervisor-recovery.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would put reconciliation helper coverage and heavier recovery integration flows back into one file, increasing edit overlap and making failures less localized.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery.test.ts`; `npm ci`; `npm run build`
### Scratchpad
- 2026-03-17: Baseline for #487 was `npx tsx --test src/supervisor/supervisor-recovery.test.ts`, which passed with 11 tests before the split and exposed a clean seam of 8 reconciliation tests plus 3 failure-flow tests.
- 2026-03-17: Split recovery coverage into `src/supervisor/supervisor-recovery-reconciliation.test.ts` and `src/supervisor/supervisor-recovery-failure-flows.test.ts`, leaving `src/supervisor/supervisor-recovery.test.ts` as a thin import-only facade.
- 2026-03-17: Focused verification for #487 was `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts` and `npx tsx --test src/supervisor/supervisor-recovery.test.ts`; `npm run build` initially failed with `sh: 1: tsc: not found`, then `npm ci` restored the toolchain and `npm run build` passed.
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
