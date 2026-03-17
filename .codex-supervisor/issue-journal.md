# Issue #480: CodeRabbit draft-skip handling: re-arm review waiting after ready-for-review

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/480
- Branch: codex/issue-480
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/.codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: ca3acc60d31393fbc3bdd1612ea168840dda7cf7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T12:39:41.653Z

## Latest Codex Summary
Implemented the CodeRabbit draft-skip re-arm fix in [src/pull-request-state.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/src/pull-request-state.ts). The state machine now reuses `review_wait_started_at` after a PR becomes ready for review when the latest prior configured-bot signal was a draft skip, and it stops that re-wait as soon as a newer actionable bot signal arrives.

Added focused regressions in [src/pull-request-state-provider-waits.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/src/pull-request-state-provider-waits.test.ts) and [src/supervisor/supervisor-lifecycle.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/src/supervisor/supervisor-lifecycle.test.ts), committed the change as `ca3acc6` (`Re-arm CodeRabbit wait after draft skip`), reran the focused tests plus `npm run build`, pushed `codex/issue-480` to `origin`, and opened draft PR #482 (`https://github.com/TommyKammy/codex-supervisor/pull/482`). The only remaining workspace change is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Re-armed CodeRabbit review waiting after ready-for-review when the prior signal was a draft skip, reran focused verification, pushed `codex/issue-480`, and opened draft PR #482.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-provider-waits.test.ts src/supervisor/supervisor-lifecycle.test.ts`; `npm run build`
Failure signature: none
Next action: Watch PR #482 for CI and review feedback, then address any follow-up.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: after a PR is marked ready for review, a prior CodeRabbit draft-skip comment was not re-arming the configured-bot wait because state inference only looked at stale CI/current-head timestamps and ignored the refreshed `review_wait_started_at` window.
- What changed: added a draft-skip-specific CodeRabbit re-wait rule in `inferStateFromPullRequest` keyed off `review_wait_started_at > configuredBotDraftSkipAt`, with the wait clearing once a fresh actionable configured-bot signal arrives after ready-for-review; added focused regression tests at both the state-inference and lifecycle layers.
- Current blocker: none
- Next exact step: Monitor PR #482 CI/review results and address any follow-up if the draft checkpoint draws feedback.
- Verification gap: none locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/pull-request-state.ts`, `src/pull-request-state-provider-waits.test.ts`, `src/supervisor/supervisor-lifecycle.test.ts`
- Rollback concern: reverting this issue should remove only the draft-skip re-arm check that depends on `review_wait_started_at`; the existing CodeRabbit initial-grace and settled-wait behaviors should stay intact.
- Last focused command: `npx tsx --test src/pull-request-state-provider-waits.test.ts src/supervisor/supervisor-lifecycle.test.ts`; `npm run build`; `git push -u origin codex/issue-480`; `gh pr create --draft --base main --head codex/issue-480 ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: required current-head CI completion metadata was absent from configured-bot hydration, so no stable `currentHeadCiGreenAt` value existed for later CodeRabbit provider-start wait logic.
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
