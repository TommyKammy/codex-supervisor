# Issue #506: Change-risk explainability: surface the applied verification policy in status output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/506
- Branch: codex/issue-506
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-506
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-506/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 3a85dbe2844453cef67a05aa1a4d5d2a6e7663d5
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851ANbp
- Repeated failure signature count: 1
- Updated at: 2026-03-17T22:26:11.000Z

## Latest Codex Summary
Removed the stale Active Failure Context that still quoted the already-resolved line-54 truncation report after commit `3a85dbe`. I also restored the inherited scratchpad tail from `HEAD` so this workspace-local journal state no longer reintroduces the same truncation while tracking PR #515 review follow-up.

Summary: Cleared the stale journal failure context for PR #515 and restored the full scratchpad tail in the local handoff.
State hint: local_review_fix
Blocked reason: none
Tests: `git diff --check`
Failure signature: PRRT_kwDORgvdZ851ANbp
Next action: Commit and push this journal-only repair to `codex/issue-506`, then resolve thread `PRRT_kwDORgvdZ851ANbp` on PR #515 if it still shows open.

## Active Failure Context
- None. The prior line-54 truncation context was resolved in commit `3a85dbe`; this turn removes the stale copied note from the journal handoff.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining PR #515 review issue is the stale copied failure context in this journal, so removing it and restoring the intact inherited scratchpad tail should clear the thread without changing supervisor behavior.
- What changed: removed the stale Active Failure Context that still described the already-fixed truncation and restored the full scratchpad tail from `HEAD` after the local journal update truncated it again.
- Current blocker: none
- Next exact step: run `git diff --check`, commit the journal-only repair, push `codex/issue-506`, and resolve CodeRabbit thread `PRRT_kwDORgvdZ851ANbp` if it remains open.
- Verification gap: none expected for this journal-only repair beyond `git diff --check`.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this repair would reintroduce the stale failure-context note and the broken scratchpad tail into the shared journal state.
- Last focused command: `git show HEAD:.codex-supervisor/issue-journal.md | sed -n '1,220p'`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Local review repair for PR #515 removes the stale Active Failure Context copied from the resolved line-54 truncation report and restores the inherited scratchpad tail from `HEAD`; focused verification target is `git diff --check`.
- 2026-03-18 (JST): Committed and pushed `3a85dbe` (`Fix truncated journal scratchpad entry`) on `codex/issue-506`, restoring the inherited `#477` scratchpad tail plus the omitted follow-on notes and resolving CodeRabbit thread `PRRT_kwDORgvdZ851AJNQ`.
- 2026-03-18 (JST): Pushed `3458587` (`Explain verification policy in status`) to `origin/codex/issue-506` and opened draft PR #515 (`https://github.com/TommyKammy/codex-supervisor/pull/515`).
- 2026-03-18 (JST): Issue #506 now renders `verification_policy intensity=<...> driver=<source>:<classes>` in status output; focused coverage includes docs-only `changed_files` and stronger `issue_metadata` auth cases.
- 2026-03-18 (JST): Focused verification for #506 was `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-change-risk-status.test.ts`; `npm run build` initially failed with `sh: 1: tsc: not found`, `npm ci` restored the toolchain, and the rerun passed.
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
