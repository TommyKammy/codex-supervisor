# Issue #494: External-review cleanup: align tests with the refined external-review module boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/494
- Branch: codex/issue-494
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-494
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-494/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 90ece797d3ff86ac512dcf7788d31e7d2c3beff6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8508oYP
- Repeated failure signature count: 1
- Updated at: 2026-03-17T18:03:57.796Z

## Latest Codex Summary
Aligned the external-review tests with the refined module split. The main change is that qualification-boundary assertions now live in [external-review-regression-candidate-qualification.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-494/src/external-review/external-review-regression-candidate-qualification.test.ts), while payload-shaping assertions stay in [external-review-regression-candidates.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-494/src/external-review/external-review-regression-candidates.test.ts). I also added a focused family layout guard in [external-review-family-layout.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-494/src/external-review/external-review-family-layout.test.ts) and refreshed [family-directory-layout.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-494/src/family-directory-layout.test.ts) so the runtime module lists match the current tree.

Verification passed with the focused external-review suite and `npm run build`. `npm ci` was needed first because `tsc` was missing in this worktree. I committed the cleanup as `90ece79` (`Align external-review tests with module boundaries`), pushed `codex/issue-494`, and opened draft PR #503: https://github.com/TommyKammy/codex-supervisor/pull/503. The only remaining local dirt is the untracked `.codex-supervisor/replay/` directory, which I left alone.

Summary: External-review test boundaries now match the refined qualification/candidate split, focused layout coverage was added, verification passed, and draft PR #503 is open.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/external-review/external-review-family-layout.test.ts src/external-review/external-review-regression-candidate-qualification.test.ts src/external-review/external-review-regression-candidates.test.ts src/external-review/external-review-durable-guardrail-candidates.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: Wait for PR review on #503 and address any feedback or CI failures if they appear.

## Active Failure Context
- None recorded. The CodeRabbit thread on scratchpad date-basis ambiguity was fixed in commit `30b3066` and resolved on PR #503.

## Codex Working Notes
### Current Handoff
- Hypothesis: the external-review cleanup is stable, and the only follow-up needed was to keep the journal metadata self-consistent by making the scratchpad's local-date basis explicit alongside the UTC snapshot field.
- What changed: clarified the scratchpad date basis in this journal, pushed commit `30b3066` (`Clarify journal scratchpad date basis`) to `origin/codex/issue-494`, and resolved the remaining CodeRabbit thread on PR #503.
- Current blocker: none
- Next exact step: Monitor PR #503 for any additional review or CI changes.
- Verification gap: none beyond confirming the journal diff; this change does not alter runtime code or tests.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: removing the timezone note would reintroduce the same UTC-vs-local timeline ambiguity that triggered the review thread.
- Last focused command: `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ8508oYP`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
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
