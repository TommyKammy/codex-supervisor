# Issue #506: Change-risk explainability: surface the applied verification policy in status output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/506
- Branch: codex/issue-506
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-506
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-506/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 34585870fade47caf22f05888d90976807ab9958
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851AJNQ
- Repeated failure signature count: 1
- Updated at: 2026-03-17T22:15:29.980Z

## Latest Codex Summary
Implementation commit `3458587` is pushed on `codex/issue-506`, and draft PR [#515](https://github.com/TommyKammy/codex-supervisor/pull/515) is open. The PR is currently `CLEAN`, and its initial GitHub checks are green: `build (ubuntu-latest)`, `build (macos-latest)`, and `CodeRabbit`.

I updated [issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-506/.codex-supervisor/issue-journal.md) for this turn, but I did not commit it because the journal already had pre-existing tracked local edits and a truncated inherited tail; the only other local state is the pre-existing untracked `.codex-supervisor/replay/` directory. The reviewable code checkpoint remains the pushed `3458587` commit on the PR.

Summary: Pushed `3458587`, opened draft PR #515, confirmed PR merge state is CLEAN and initial checks are green; only the local journal update and pre-existing replay dir remain uncommitted.
State hint: draft_pr
Blocked reason: none
Tests: Not re-run locally this turn; previously passed `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-change-risk-status.test.ts` and `npm run build`. PR #515 checks are green: `build (ubuntu-latest)`, `build (macos-latest)`, `CodeRabbit`.
Failure signature: none
Next action: Monitor PR #515 for review/CI follow-up and decide whether to normalize or separately clean up the inherited local journal state before the next checkpoint.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/515#discussion_r2949820349
- Details:
  - .codex-supervisor/issue-journal.md:54 _⚠️ Potential issue_ | _🟡 Minor_ **Truncated scratchpad entry.** Line 54 appears to be cut off mid-sentence: `"...since the d"`. This is a minor cosmetic issue in the journal file. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 54, The journal entry for 2026-03-17 is truncated mid-sentence (ends with "since the d"); locate the entry containing "2026-03-17: Focused reproducer for `#477`" and the fragment "configured_bot_initial_grace_wait pause_reason=awaiting_initial_provider_activity recent_observation=required_checks_green", then restore or rewrite the remainder of the sentence so it completes the thought (e.g., finish "since the devic[e]/day/dispatch" with the correct phrase or remove the trailing fragment), ensuring the line ends cleanly and the entry reads as a full sentence. ``` </details> <!-- fingerprinting:phantom:poseidon:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: status should render one compact `verification_policy` line from the normalized change-risk decision so operators can see both the applied verification intensity and the source that drove it without reading explain diagnostics.
- What changed: added `buildVerificationPolicyStatusLine`, threaded `verificationPolicySummary` through active status loading and summary rendering, fetched the active issue when available so issue metadata can override low-risk changed files, and added focused renderer plus `supervisor.status()` coverage for docs-only and metadata-driven cases.
- Current blocker: none
- Next exact step: Monitor PR #515 for CI and review feedback, then address any follow-up on `codex/issue-506`.
- Verification gap: none at the code level; focused supervisor status tests and `npm run build` passed after restoring the local toolchain with `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-change-risk-status.test.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor-status-rendering.test.ts`, `src/supervisor/supervisor-status-rendering.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting this change would remove the new status explainability line and leave metadata-driven verification intensity visible only indirectly through change classes or prompt generation.
- Last focused command: `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-change-risk-status.test.ts && npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
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
