# Issue #480: CodeRabbit draft-skip handling: re-arm review waiting after ready-for-review

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/480
- Branch: codex/issue-480
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 2e70af0a377fb7866940d1d9dd1b59db5568dcd6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8502s12
- Repeated failure signature count: 1
- Updated at: 2026-03-17T21:49:38+09:00

## Latest Codex Summary
Addressed the remaining CodeRabbit review on PR [#482](https://github.com/TommyKammy/codex-supervisor/pull/482) by hardening `latestConfiguredBotActionableSignalAt` in [src/pull-request-state.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/src/pull-request-state.ts) so it pre-parses configured-bot timestamps, drops malformed values, and selects the newest valid actionable signal. The repair is committed as `2e70af0` (`Ignore malformed configured-bot timestamps`) and pushed to `origin/codex/issue-480`.

Added a focused regression in [src/pull-request-state-provider-waits.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/src/pull-request-state-provider-waits.test.ts) covering a draft-skip re-arm case where `configuredBotCurrentHeadObservedAt` is malformed but a newer valid top-level review timestamp should still clear the wait. Verification passed with `npx tsx --test src/pull-request-state-provider-waits.test.ts` and `npm run build`.

Summary: Fixed the malformed configured-bot timestamp selection noted in PR #482, added a focused regression, reran the targeted test file plus `npm run build`, and pushed commit `2e70af0`.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-provider-waits.test.ts`; `npm run build`
Failure signature: none
Next action: Watch PR #482 CI/review results and resolve or answer the CodeRabbit thread if any follow-up remains.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread is valid because `latestConfiguredBotActionableSignalAt` still compares raw timestamp strings, so a malformed earlier value can mask a newer valid configured-bot signal and incorrectly keep the draft-skip re-wait active.
- What changed: `latestConfiguredBotActionableSignalAt` now pre-parses the configured-bot timestamp candidates, drops invalid values, and reduces over numeric epochs; added a regression proving a malformed `configuredBotCurrentHeadObservedAt` no longer blocks a newer `configuredBotTopLevelReviewSubmittedAt` from clearing the re-armed wait.
- Current blocker: none
- Next exact step: Watch PR #482 CI/review results for commit `2e70af0` and resolve or answer the CodeRabbit thread if it needs explicit follow-up.
- Verification gap: none locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/pull-request-state.ts`, `src/pull-request-state-provider-waits.test.ts`
- Rollback concern: reverting this repair should only affect malformed configured-bot timestamp handling; the draft-skip re-arm logic from `ca3acc6` should remain intact.
- Last focused command: `npx tsx --test src/pull-request-state-provider-waits.test.ts`; `npm run build`; `git push origin codex/issue-480`
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
- 2026-03-17: Review repair for PR #482 filters malformed configured-bot timestamps before selecting the latest actionable signal; focused regression/verification was `npx tsx --test src/pull-request-state-provider-waits.test.ts` and `npm run build`.
