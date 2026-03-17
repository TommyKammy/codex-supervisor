# Issue #485: Test cleanup: split supervisor diagnostics coverage by status and explanation boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/485
- Branch: codex/issue-485
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 4ecf965703c7c057f25066ec23f83d2cc82797da
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-17T15:25:02Z

## Latest Codex Summary
Pushed `4ecf965` (`test: fix diagnostics review follow-ups`) to `origin/codex/issue-485` for PR [#497](https://github.com/TommyKammy/codex-supervisor/pull/497). The repair keeps the diagnostics split behavior-neutral while tightening the guardrail provenance tests so committed shared-memory fixtures are written, added, and committed before `headSha` is captured; the journal summary also stays free of absolute workspace markdown links.

Focused verification passed after the repair: `npx tsx --test src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts` and `npm run build`. After the push, I resolved both CodeRabbit review threads (`PRRT_kwDORgvdZ8505wKg` and `PRRT_kwDORgvdZ8505wKi`) with `gh api graphql`.

Summary: Pushed the PR #497 review repair for committed guardrail provenance and cleared the two addressed CodeRabbit threads.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #497 for the post-push CI run and any fresh review feedback.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #485 can stay behavior-neutral by extracting supervisor diagnostics coverage into four files that match the existing ownership boundaries: doctor/status selection, explain, handoff summary, and guardrail provenance, with the legacy path preserved as a facade import.
- What changed: kept the diagnostics split intact and repaired `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts` so both provenance tests commit `docs/shared-memory/*.json` before capturing `headSha`; retained the repo-safe journal summary text instead of reintroducing absolute workspace markdown links.
- Current blocker: none
- Next exact step: Monitor PR #497 for the CI run triggered by `4ecf965` and handle any new review or verification signal on `codex/issue-485`.
- Verification gap: none for the touched guardrail provenance suite or `npm run build`.
- Files touched: `src/supervisor/supervisor-diagnostics.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-handoff-summary.test.ts`, `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would collapse unrelated diagnostics assertions back into a single 1k+ line file, increasing churn and making focused failures harder to localize.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-17: Pushed `4ecf965` to `origin/codex/issue-485` and resolved CodeRabbit threads `PRRT_kwDORgvdZ8505wKg` and `PRRT_kwDORgvdZ8505wKi` after verifying `npx tsx --test src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts` and `npm run build`.
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
