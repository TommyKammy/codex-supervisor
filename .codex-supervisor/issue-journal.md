# Issue #485: Test cleanup: split supervisor diagnostics coverage by status and explanation boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/485
- Branch: codex/issue-485
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 13ea09dc5bc68ba9dedf4036da6bef2856cb9520
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T00:04:40+09:00

## Latest Codex Summary
- Split `src/supervisor/supervisor-diagnostics.test.ts` into focused status-selection, explain, handoff-summary, and guardrail-reporting suites while keeping the original file as a side-effect import facade. Focused diagnostics/status-reporting tests and `npm run build` pass after restoring missing dev dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #485 can stay behavior-neutral by extracting supervisor diagnostics coverage into four files that match the existing ownership boundaries: doctor/status selection, explain, handoff summary, and guardrail provenance, with the legacy path preserved as a facade import.
- What changed: added `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-handoff-summary.test.ts`, and `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`; reduced `src/supervisor/supervisor-diagnostics.test.ts` to side-effect imports only; restored the local toolchain with `npm ci` after `npm run build` initially failed with `sh: 1: tsc: not found`.
- Current blocker: none
- Next exact step: Commit the split on `codex/issue-485`, then open or update the draft PR if needed.
- Verification gap: none for the focused diagnostics/status-reporting suites or `npm run build`.
- Files touched: `src/supervisor/supervisor-diagnostics.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-handoff-summary.test.ts`, `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would collapse unrelated diagnostics assertions back into a single 1k+ line file, increasing churn and making focused failures harder to localize.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18: Focused reproducer for #485 was the existing monolithic `src/supervisor/supervisor-diagnostics.test.ts` passing as a single 1113-line file; cleanup kept assertions behavior-neutral by moving the same coverage into four targeted suites plus a 4-line facade.
- 2026-03-18: Verification for #485 was `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-handoff-summary.test.ts src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`, `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-review-bot.test.ts`, `npm ci`, and `npm run build`.
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
