# Issue #480: CodeRabbit draft-skip handling: re-arm review waiting after ready-for-review

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/480
- Branch: codex/issue-480
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 9a7289c4ebdda3639119dc1510dfb0b88913708f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-17T12:59:10Z

## Latest Codex Summary
Updated the live journal links for [src/pull-request-state.ts](../src/pull-request-state.ts) and [src/pull-request-state-provider-waits.test.ts](../src/pull-request-state-provider-waits.test.ts) so PR #482 no longer points reviewers at local `/home/...` filesystem paths. The fix is committed as `9a7289c` (`Use repo-relative journal links`) and pushed to `origin/codex/issue-480`.

No code paths changed, so I verified the repair by diffing the journal and confirming the only remaining absolute paths are inside the quoted CodeRabbit failure context. I then resolved review thread `PRRT_kwDORgvdZ850206I` via `gh api graphql`. The worktree is clean aside from the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Fixed the remaining PR #482 review thread by replacing broken local journal links with repository-relative markdown targets, pushed commit `9a7289c`, and resolved the thread.
State hint: waiting_ci
Blocked reason: none
Tests: not run (journal-only markdown change); verified with `git diff -- .codex-supervisor/issue-journal.md` and `rg -n '\\]\\(/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/' .codex-supervisor/issue-journal.md`
Failure signature: none
Next action: Watch PR #482 CI/review results for commit `9a7289c` and handle any follow-up review noise if it appears.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the reported review thread was valid and was fully addressed by switching the live journal links to repository-relative targets; no runtime code changes were needed.
- What changed: replaced the live summary links in this journal with repository-relative `../src/...` targets, pushed commit `9a7289c`, and resolved the corresponding CodeRabbit review thread after confirming the diff.
- Current blocker: none
- Next exact step: Monitor PR #482 CI/review results for commit `9a7289c` and only re-enter review repair if a new thread appears.
- Verification gap: no automated checks rerun because this change is journal markdown only.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this repair would only restore broken local-path links in the journal; it does not affect runtime behavior.
- Last focused command: `git push origin codex/issue-480`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ850206I`
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
- 2026-03-17: Follow-up review repair for PR #482 updates the live journal summary links from absolute `/home/...` targets to repository-relative `../src/...` paths so CodeRabbit readers can open them from the repo view.
- 2026-03-17: Pushed `9a7289c` (`Use repo-relative journal links`) to `origin/codex/issue-480` and resolved CodeRabbit thread `PRRT_kwDORgvdZ850206I` with `gh api graphql`.
