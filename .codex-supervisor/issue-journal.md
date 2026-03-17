# Issue #491: External-review cleanup: tighten the signal-heuristics and normalization boundary

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/491
- Branch: codex/issue-491
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-491
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-491/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 18af0964675dd972a9db716197af125cf9b75cba
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T16:15:30.271Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #491 can stay behavior-neutral by moving provider-specific external-review signal collection out of `external-review-normalization.ts`, leaving normalization focused on shaping preselected signal envelopes into findings.
- What changed: added focused `external-review-signal-collection.test.ts` coverage for provider-activity filtering, extracted `collectExternalReviewSignals` and the thread/review/comment selection helpers into `src/external-review/external-review-signal-collection.ts`, moved shared signal types into `src/external-review/external-review-signals.ts`, and updated normalization/classifier/miss-persistence tests to use the explicit `signal -> normalized finding` boundary.
- Current blocker: none
- Next exact step: Commit the external-review boundary cleanup on `codex/issue-491`, then check whether a draft PR already exists for the branch before opening or updating one.
- Verification gap: none for the focused external-review suites or `npm run build`; `npm ci` was required first because `tsc` was initially unavailable locally in this worktree.
- Files touched: `src/external-review/external-review-signal-collection.ts`, `src/external-review/external-review-signals.ts`, `src/external-review/external-review-normalization.ts`, `src/external-review/external-review-misses.ts`, `src/external-review/external-review-miss-persistence.ts`, `src/external-review/external-review-durable-guardrail-candidates.ts`, `src/external-review/external-review-miss-artifact-types.ts`, `src/external-review/external-review-signal-collection.test.ts`, `src/external-review/external-review-normalization.test.ts`, `src/external-review/external-review-classifier.test.ts`, `src/external-review/external-review-miss-persistence.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would put configured-bot selection and actionable filtering back into normalization, which makes future provider-signal changes span both collection and finding-shaping code paths again.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18: Focused reproducer for #491 was a new `external-review-signal-collection.test.ts` suite that pins provider-activity behavior separately from `normalizeExternalReviewSignal`, including last-configured-bot thread comment selection, actionable state-only top-level reviews, and closed-PR issue-comment filtering.
- 2026-03-18: #491 cleanup extracts provider signal collection into `external-review-signal-collection.ts` and shared signal types into `external-review-signals.ts`; `external-review-normalization.ts` now only shapes signal envelopes into normalized findings.
- 2026-03-18: Focused verification for #491 was `npx tsx --test src/external-review/external-review-signal-collection.test.ts src/external-review/external-review-normalization.test.ts src/external-review/external-review-classifier.test.ts src/external-review/external-review-miss-persistence.test.ts`.
- 2026-03-18: `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain, then the rerun of the focused suites and `npm run build` passed.
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
