# Issue #485: Test cleanup: split supervisor diagnostics coverage by status and explanation boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/485
- Branch: codex/issue-485
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/.codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: e64c9bdcddd2d653c7f423899768359c1f2f7a65
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T01:15:00+09:00

## Latest Codex Summary
Split the diagnostics monolith into four focused suites and reduced the original entrypoint to a thin facade at [src/supervisor/supervisor-diagnostics.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/src/supervisor/supervisor-diagnostics.test.ts). The new coverage boundaries are [src/supervisor/supervisor-diagnostics-status-selection.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/src/supervisor/supervisor-diagnostics-status-selection.test.ts), [src/supervisor/supervisor-diagnostics-explain.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/src/supervisor/supervisor-diagnostics-explain.test.ts), [src/supervisor/supervisor-diagnostics-handoff-summary.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/src/supervisor/supervisor-diagnostics-handoff-summary.test.ts), and [src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts). I also updated the handoff notes in [issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-485/.codex-supervisor/issue-journal.md).

Focused diagnostics/status-reporting verification passed, and `npm run build` passed after restoring missing dev dependencies with `npm ci`. Checkpoint commit is `e64c9bd` (`Split supervisor diagnostics coverage`). I pushed `codex/issue-485` to `origin` and opened draft PR #497: https://github.com/TommyKammy/codex-supervisor/pull/497. The only remaining workspace noise is unrelated untracked state under `.codex-supervisor/replay/`.

Summary: Split supervisor diagnostics coverage into focused status-selection, explain, handoff-summary, and guardrail-reporting suites; kept the legacy diagnostics file as a facade import and committed the cleanup as `e64c9bd`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-handoff-summary.test.ts src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-review-bot.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #497, let CI/reporting settle, and address any review or verification failures if they appear.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #485 can stay behavior-neutral by extracting supervisor diagnostics coverage into four files that match the existing ownership boundaries: doctor/status selection, explain, handoff summary, and guardrail provenance, with the legacy path preserved as a facade import.
- What changed: added `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-handoff-summary.test.ts`, and `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`; reduced `src/supervisor/supervisor-diagnostics.test.ts` to side-effect imports only; restored the local toolchain with `npm ci` after `npm run build` initially failed with `sh: 1: tsc: not found`.
- Current blocker: none
- Next exact step: Watch draft PR #497 for CI and review signals; if merge state stays dirty or checks fail, reproduce locally and repair on `codex/issue-485`.
- Verification gap: none for the focused diagnostics/status-reporting suites or `npm run build`.
- Files touched: `src/supervisor/supervisor-diagnostics.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-diagnostics-handoff-summary.test.ts`, `src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would collapse unrelated diagnostics assertions back into a single 1k+ line file, increasing churn and making focused failures harder to localize.
- Last focused command: `gh pr create --draft --base main --head codex/issue-485 --title "test: split supervisor diagnostics coverage" ...`
### Scratchpad
- 2026-03-18: Pushed `codex/issue-485` to `origin` and opened draft PR #497 (`https://github.com/TommyKammy/codex-supervisor/pull/497`); initial PR merge state was `UNSTABLE`.
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
