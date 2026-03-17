# Issue #477: CodeRabbit draft-skip handling: explain re-wait behavior in status output and docs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/477
- Branch: codex/issue-477
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-477
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-477/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: cc4d64785fdd3c3093b34e9b6ff7dfd8d279d3bd
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T13:13:51.855Z

## Latest Codex Summary
- Status output now distinguishes CodeRabbit's post-ready draft-skip re-wait from the existing startup grace and settled waits, and the docs explain that the supervisor intentionally re-waits for a fresh ready-state review signal.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the operator confusion comes from status reusing the generic initial CodeRabbit grace wording after ready-for-review, even when the actual reason is that the last prior CodeRabbit signal was only a draft skip.
- What changed: taught `configuredBotInitialGraceWaitWindow` to detect the draft-skip re-wait from `review_wait_started_at`, emit distinct `pause_reason=awaiting_fresh_provider_review_after_draft_skip` and `recent_observation=ready_for_review_reopened_wait`, threaded the active record into status assembly, added focused helper/model/rendering tests, and documented the re-wait in `README.md`, `docs/getting-started.md`, and `docs/configuration.md`.
- Current blocker: none
- Next exact step: Commit the status/docs change on `codex/issue-477`, then open or update the draft PR and monitor CI/review.
- Verification gap: none locally after restoring `node_modules` with `npm ci`.
- Files touched: `src/supervisor/supervisor-status-review-bot.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-status-review-bot.test.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`, `README.md`, `docs/getting-started.md`, `docs/configuration.md`
- Rollback concern: reverting this change would collapse the new draft-skip re-wait wording back into the generic initial-grace label, making post-ready waits look like unexplained loops again.
- Last focused command: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm ci`; `npm run build`
### Scratchpad
- Focused derivation rule: use the latest completion timestamp among required current-head checks, but only when every required current-head check on the tracked head is already passing/skipping; otherwise leave the field null.
- Verification commands: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm ci`; `npm run build`.
- Local failure resolved: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree was missing `node_modules`; `npm ci` restored the local toolchain and the acceptance build passed afterward.
- 2026-03-17: Focused reproducer was `inferStateFromPullRequest` returning `ready_to_merge` instead of `waiting_ci` when `currentHeadCiGreenAt=2026-03-13T02:05:00Z`, CodeRabbit was configured, and no `configuredBotCurrentHeadObservedAt` existed. The new initial grace wait covers that silent-provider window and hands off to the existing settled wait once `configuredBotCurrentHeadObservedAt` appears.
- 2026-03-17: Focused reproducer for this issue was the active status output omitting the configured wait length. Tightened tests expected `configured_wait_seconds=90` on `configured_bot_initial_grace_wait` and `configured_wait_seconds=5` on `configured_bot_settled_wait`; those failed before the status helper/assembly update and now pass.
- 2026-03-17: Focused reproducer for #478 was `buildConfiguredBotReviewSummary` returning only `{ lifecycle.state: "requested", arrivedAt: null }` for a CodeRabbit draft-skip issue comment, with no structured field distinguishing it from summary-only informational comments.
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
