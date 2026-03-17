# Issue #485: Test cleanup: split supervisor diagnostics coverage by status and explanation boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/485
- Branch: codex/issue-485
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 5ce1e8181e8992a0c408f8daff2b6e95bc257056
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-17T15:23:15Z

## Latest Codex Summary
Prepared a review-repair follow-up for PR [#497](https://github.com/TommyKammy/codex-supervisor/pull/497): the guardrail provenance tests now commit shared-memory fixtures before capturing `headSha`, so the mocked PR head truly represents committed durable guidance. The journal handoff summary still avoids absolute workspace markdown links, which addresses the repo-link review comment once this turn is committed.

Focused verification passed after the repair: `npx tsx --test src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts` and `npm run build`. An intermediate failed test run caught an ordering mistake where I tried to stage `external-review-guardrails.json` before writing it; that was corrected before the passing rerun.

Summary: Repaired the PR #497 review findings locally by committing shared-memory guardrail fixtures before `headSha` capture and preserving repo-safe journal summary links.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`; `npm run build`
Failure signature: none
Next action: Commit and push this review repair to `codex/issue-485`, then re-check PR #497 and clear the addressed review threads.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #485 can stay behavior-neutral by extracting supervisor diagnostics coverage into four files that match the existing ownership boundaries: doctor/status selection, explain, handoff summary, and guardrail provenance, with the legacy path preserved as a facade import.
- What changed: kept the diagnostics split intact and repaired `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts` so both provenance tests commit `docs/shared-memory/*.json` before capturing `headSha`; retained the repo-safe journal summary text instead of reintroducing absolute workspace markdown links.
- Current blocker: none
- Next exact step: Push the review-repair commit to `origin/codex/issue-485`, then re-check PR #497 for fresh CI/review signals and resolve the addressed threads if the remote matches.
- Verification gap: none for the touched guardrail provenance suite or `npm run build`.
- Files touched: `src/supervisor/supervisor-diagnostics.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-handoff-summary.test.ts`, `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would collapse unrelated diagnostics assertions back into a single 1k+ line file, increasing churn and making focused failures harder to localize.
- Last focused command: `npm run build`
### Scratchpad
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
