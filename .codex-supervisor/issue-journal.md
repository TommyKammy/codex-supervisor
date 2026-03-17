# Issue #506: Change-risk explainability: surface the applied verification policy in status output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/506
- Branch: codex/issue-506
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 646ea24338b7d9a259f30e38ae1d1963bdc17725
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851ATvh
- Repeated failure signature count: 1
- Updated at: 2026-03-17T22:37:13.000Z

## Latest Codex Summary
Updated [`src/core/journal.ts`](../src/core/journal.ts) so tracked journal snapshots render `Workspace` as `.` and `Journal` relative to the workspace root instead of serializing absolute local filesystem paths. Added a focused regression in [`src/journal.test.ts`](../src/journal.test.ts) and normalized this tracked journal snapshot to the new format.

Focused verification passed: `npx tsx --test src/journal.test.ts` and `npm run build`.

Summary: Prepared the PR #515 review repair by making tracked journal paths workspace-relative and covering the output with a regression test.
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ851ATvh
Next action: Commit and push this review repair to `codex/issue-506`, then resolve CodeRabbit thread `PRRT_kwDORgvdZ851ATvh` on PR #515 if it remains open.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/515#discussion_r2949876357
- Details:
  - .codex-supervisor/issue-journal.md:7 _⚠️ Potential issue_ | _🟠 Major_ **Avoid committing absolute local filesystem paths in journal metadata.** These values expose local environment details (`/home/tommy/...`) and make the journal less portable across contributors/worktrees. Prefer repo-relative values in tracked files. <details> <summary>🔧 Suggested change</summary> ```diff -- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-506 -- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-506/.codex-supervisor/issue-journal.md +- Workspace: . +- Journal: .codex-supervisor/issue-journal.md ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion - Workspace: . - Journal: .codex-supervisor/issue-journal.md ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 6 - 7, The journal currently contains absolute local paths for the keys "Workspace" and "Journal" which leaks user-specific filesystem info; update the file .codex-supervisor/issue-journal.md (the "Workspace" and "Journal" entries) to use repo-relative paths (e.g., paths relative to repository root or ./worktree-name) or canonical placeholders, and if there is code that generates this metadata, change the writer to compute and store repo-relative paths (use path.relative(repoRoot, absPath) or equivalent) instead of absolute paths so committed journal files remain portable across machines. ``` </details> <!-- fingerprinting:phantom:triton:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR #515 review thread is caused by the journal snapshot serializer still emitting absolute local paths, so making the tracked `Workspace`/`Journal` lines workspace-relative should clear it without changing runtime record paths.
- What changed: updated `src/core/journal.ts` to render tracked `Workspace`/`Journal` paths relative to the workspace root, added a focused regression in `src/journal.test.ts`, normalized this journal snapshot to match, and restored the inherited scratchpad tail after the local journal update truncated it again.
- Current blocker: none
- Next exact step: commit and push this review repair to `codex/issue-506`, then resolve CodeRabbit thread `PRRT_kwDORgvdZ851ATvh` on PR #515 if it remains open.
- Verification gap: none; `npx tsx --test src/journal.test.ts` and `npm run build` passed for the serializer change.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/journal.ts`, `src/journal.test.ts`
- Rollback concern: reverting this repair would re-expose absolute local paths in tracked journal snapshots and likely reopen the current review issue.
- Last focused command: `npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Review repair for PR #515 now renders tracked journal `Workspace`/`Journal` snapshot fields relative to the workspace root, adds a focused regression in `src/journal.test.ts`, and passes `npx tsx --test src/journal.test.ts` plus `npm run build`.
- 2026-03-18 (JST): Pushed `646ea24` (`Clear stale journal failure context`) to `origin/codex/issue-506` and resolved CodeRabbit thread `PRRT_kwDORgvdZ851ANbp` with `gh api graphql` after removing the stale copied failure context and restoring the inherited scratchpad tail.
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
