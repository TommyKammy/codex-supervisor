# Issue #480: CodeRabbit draft-skip handling: re-arm review waiting after ready-for-review

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/480
- Branch: codex/issue-480
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 206af515f555aab515cfd156834f82db7fc6fe3f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ850206I
- Repeated failure signature count: 1
- Updated at: 2026-03-17T12:58:16Z

## Latest Codex Summary
Updated the live journal links for [src/pull-request-state.ts](../src/pull-request-state.ts) and [src/pull-request-state-provider-waits.test.ts](../src/pull-request-state-provider-waits.test.ts) so PR #482 no longer points reviewers at local `/home/...` filesystem paths.

No code paths changed, so I verified the repair by diffing the journal and confirming the only remaining absolute paths are inside the quoted CodeRabbit failure context. The worktree still includes the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Fixed the remaining PR #482 review thread by replacing broken local journal links with repository-relative markdown targets.
State hint: local_review_fix
Blocked reason: none
Tests: not run (journal-only markdown change); verified with `git diff -- .codex-supervisor/issue-journal.md` and `rg -n '\\]\\(/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/' .codex-supervisor/issue-journal.md`
Failure signature: PRRT_kwDORgvdZ850206I
Next action: Commit and push the journal link repair on `codex/issue-480`, then resolve the CodeRabbit thread if the PR updates cleanly.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/482#discussion_r2946567748
- Details:
  - .codex-supervisor/issue-journal.md:19 _⚠️ Potential issue_ | _🟡 Minor_ **Replace local filesystem markdown links with repository-relative links.** Line 17 and Line 19 use `/home/...` paths, which break for everyone except the local machine that generated them. <details> <summary>Suggested fix</summary> ```diff -Addressed the remaining CodeRabbit review on PR [`#482`](https://github.com/TommyKammy/codex-supervisor/pull/482) by hardening `latestConfiguredBotActionableSignalAt` in [src/pull-request-state.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/src/pull-request-state.ts) so it pre-parses configured-bot timestamps, drops malformed values, and selects the newest valid actionable signal. The repair is committed as `2e70af0` (`Ignore malformed configured-bot timestamps`) and pushed to `origin/codex/issue-480`. +Addressed the remaining CodeRabbit review on PR [`#482`](https://github.com/TommyKammy/codex-supervisor/pull/482) by hardening `latestConfiguredBotActionableSignalAt` in [src/pull-request-state.ts](../src/pull-request-state.ts) so it pre-parses configured-bot timestamps, drops malformed values, and selects the newest valid actionable signal. The repair is committed as `2e70af0` (`Ignore malformed configured-bot timestamps`) and pushed to `origin/codex/issue-480`. -Added a focused regression in [src/pull-request-state-provider-waits.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/src/pull-request-state-provider-waits.test.ts) covering a draft-skip re-arm case where `configuredBotCurrentHeadObservedAt` is malformed but a newer valid top-level review timestamp should still clear the wait. Verification passed with `npx tsx --test src/pull-request-state-provider-waits.test.ts` and `npm run build`. +Added a focused regression in [src/pull-request-state-provider-waits.test.ts](../src/pull-request-state-provider-waits.test.ts) covering a draft-skip re-arm case where `configuredBotCurrentHeadObservedAt` is malformed but a newer valid top-level review timestamp should still clear the wait. Verification passed with `npx tsx --test src/pull-request-state-provider-waits.test.ts` and `npm run build`. ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 17 - 19, The markdown uses absolute local filesystem paths for links (e.g., /home/tommy/Dev/.../src/pull-request-state.ts and .../src/pull-request-state-provider-waits.test.ts) which will break for other users; update those two links in .codex-supervisor/issue-journal.md to repository-relative paths (e.g., src/pull-request-state.ts and src/pull-request-state-provider-waits.test.ts or ./src/...) so they resolve in the repo, keeping the existing text (commit 2e70af0 and branch origin/codex/issue-480) unchanged. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread is valid because the journal summary still uses absolute `/home/...` markdown targets, which break outside this local worktree even though the underlying code fix is already correct.
- What changed: replaced the live summary links in this journal with repository-relative `../src/...` targets so the PR context renders correctly for other readers without altering the referenced commit, branch, or verification details.
- Current blocker: none
- Next exact step: Commit and push the journal-only link repair on PR #482, then resolve the CodeRabbit thread if no further feedback appears.
- Verification gap: no automated checks rerun because this change is journal markdown only.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this repair would only restore broken local-path links in the journal; it does not affect runtime behavior.
- Last focused command: `rg -n '\\]\\(/home/tommy/Dev/codex-supervisor-self-worktrees/issue-480/' .codex-supervisor/issue-journal.md`; `git diff -- .codex-supervisor/issue-journal.md`
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
