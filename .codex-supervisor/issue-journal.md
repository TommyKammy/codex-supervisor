# Issue #505: Change-risk explainability: normalize risk decisions with explicit source precedence

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/505
- Branch: codex/issue-505
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 693e30b62880fccc5aa402687b52a1efae64190f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ850_ne4
- Repeated failure signature count: 1
- Updated at: 2026-03-17T21:31:57.000Z

## Latest Codex Summary
Repaired the tracked issue journal for PR #508 by converting the workspace fields and newly added file links to repo-relative paths, and by restoring the truncated scratchpad tail that had been committed in `693e30b`. The underlying #505 implementation from [src/issue-metadata/issue-metadata-change-risk-decision.ts](../src/issue-metadata/issue-metadata-change-risk-decision.ts) remains unchanged.

The shared normalized change-risk decision, prompt coverage, and focused decision tests from [src/codex/codex-prompt.ts](../src/codex/codex-prompt.ts), [src/codex/codex-prompt.test.ts](../src/codex/codex-prompt.test.ts), and [src/issue-metadata/issue-metadata-change-risk-decision.test.ts](../src/issue-metadata/issue-metadata-change-risk-decision.test.ts) remain as shipped in `395a11c`; this turn only addresses the CodeRabbit journal-path review on draft PR #508: https://github.com/TommyKammy/codex-supervisor/pull/508

One local untracked path remains: `.codex-supervisor/replay/`. I left it untouched.

Summary: Normalized the tracked journal paths to repo-relative form, converted the new journal file links to repo-relative targets, and restored the truncated scratchpad tail on PR #508.
State hint: addressing_review
Blocked reason: none
Tests: `git diff --check`
Failure signature: none
Next action: Push the journal repair, resolve thread `PRRT_kwDORgvdZ850_ne4`, and monitor PR #508 for follow-up review feedback.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the tracked issue journal should use repo-relative paths consistently, including markdown link targets, so review artifacts stay shareable without leaking a contributor-specific workspace path.
- What changed: normalized the journal `Workspace` and `Journal` fields plus the new latest-summary links to repo-relative targets, reduced the copied CodeRabbit failure context to a neutral summary, and restored the truncated #477 scratchpad tail; the underlying #505 change-risk implementation from `395a11c` remains unchanged.
- Current blocker: none
- Next exact step: Push this journal-only repair, resolve CodeRabbit thread `PRRT_kwDORgvdZ850_ne4`, and monitor PR #508 for any follow-up review.
- Verification gap: none for this repair; `git diff --check` passed and no source files changed.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this repair would reintroduce workspace-specific absolute paths into the tracked journal and restore the malformed scratchpad tail from `693e30b`.
- Last focused command: `git diff --check`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Review repair for PR #508 normalized the tracked journal `Workspace`/`Journal` fields and new summary links to repo-relative paths, reduced the copied CodeRabbit failure context to a neutral summary, restored the truncated #477 scratchpad tail from `HEAD^`, and passed `git diff --check`.
- 2026-03-18 (JST): Committed `395a11c` (`Normalize change-risk decisions`), pushed `codex/issue-505`, and opened draft PR #508 (`https://github.com/TommyKammy/codex-supervisor/pull/508`).
- 2026-03-18 (JST): Added `summarizeChangeRiskDecision` so prompt/status consumers share one normalized risk decision with `issue_metadata` tie precedence, risky approval inputs, deterministic changed-file classes, and the resulting verification intensity.
- 2026-03-18 (JST): Focused reproducer for #505 was a new `issue-metadata-change-risk-decision` test asserting `auth` metadata plus docs/tests changed files should still resolve to `verificationIntensity=strong` with `higherRiskSource=issue_metadata`.
- 2026-03-18 (JST): `npm run build` first failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain, then the focused issue-metadata/prompt tests and `npm run build` both passed.
- 2026-03-18 (JST): Pushed `30b3066` (`Clarify journal scratchpad date basis`) to `origin/codex/issue-494` and resolved CodeRabbit thread `PRRT_kwDORgvdZ8508oYP` on PR #503 with `gh api graphql`.
- 2026-03-18 (JST): Review repair for PR #503 clarifies that scratchpad entries use the workspace-local date basis while the Supervisor Snapshot `Updated at` field remains UTC.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the next `npm run build` passed.
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
