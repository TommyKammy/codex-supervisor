# Issue #486: Test cleanup: split supervisor execution coverage by orchestration and cleanup boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/486
- Branch: codex/issue-486
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-486
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-486/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3d7ddc8b15777802ca72436dce98f9e17dc1d5fb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T15:33:07.995Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #486 can stay behavior-neutral by extracting `supervisor-execution.test.ts` into two focused suites: issue-selection/orchestration coverage and workspace/lock/cleanup-heavy execution coverage, with the legacy path preserved as a facade import.
- What changed: split the execution suite into `src/supervisor/supervisor-execution-orchestration.test.ts` and `src/supervisor/supervisor-execution-cleanup.test.ts`, and reduced `src/supervisor/supervisor-execution.test.ts` to a thin facade import file.
- Current blocker: none
- Next exact step: Stage the split execution suites, commit the cleanup on `codex/issue-486`, and open or update the draft PR if needed.
- Verification gap: none for the split execution suites or `npm run build`; `npm ci` was required first because `tsc` was initially unavailable locally.
- Files touched: `src/supervisor/supervisor-execution.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would push orchestration, session-lock, orphan cleanup, and reservation recovery assertions back into one 1.6k-line suite, making failures harder to localize.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18: Split `src/supervisor/supervisor-execution.test.ts` into orchestration and cleanup suites behind a facade import; focused verification was `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-execution.test.ts`.
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
