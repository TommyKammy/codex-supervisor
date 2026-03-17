# Issue #478: CodeRabbit draft-skip handling: record draft-skip review signals distinctly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/478
- Branch: codex/issue-478
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-478
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 272b53b799ace7fbe2cbf2bf9c3852c104a30178
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T11:54:18.009Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit draft-skip issue comments were being treated as generic informational noise, so the configured-bot lifecycle could not distinguish “provider skipped because PR was draft” from “provider has not produced any meaningful signal yet.”
- What changed: Added a focused `draftSkipAt` signal to configured-bot review summaries, detected via a dedicated draft-skip heuristic, hydrated it onto `GitHubPullRequest.configuredBotDraftSkipAt`, and tightened the focused review-signal + hydrator tests so actionable arrivals still map to `arrived` while draft-skip stays separately recorded.
- Current blocker: none
- Next exact step: Stage the focused draft-skip signal changes and create a checkpoint commit on `codex/issue-478`.
- Verification gap: none for local focused verification; remote CI has not run yet.
- Files touched: `src/external-review/external-review-signal-heuristics.ts`, `src/github/github-review-signals.ts`, `src/github/github-review-signals.test.ts`, `src/github/github-hydration.ts`, `src/github/github-pull-request-hydrator.ts`, `src/github/github-pull-request-hydrator.test.ts`, `src/core/types.ts`
- Rollback concern: reverting this issue should remove only the distinct draft-skip field/heuristic; other configured-bot lifecycle and observation handling should remain unchanged.
- Last focused command: `npm run build`
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
