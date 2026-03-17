# Issue #478: CodeRabbit draft-skip handling: record draft-skip review signals distinctly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/478
- Branch: codex/issue-478
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-478
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/.codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 1074204dafb83f6eebca759446004a630225e71b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T12:04:06Z

## Latest Codex Summary
Added a distinct configured-bot draft-skip signal and kept actionable arrival semantics unchanged. The main logic lives in [src/github/github-review-signals.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/src/github/github-review-signals.ts) and [src/external-review/external-review-signal-heuristics.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/src/external-review/external-review-signal-heuristics.ts); hydration now carries it onto [src/core/types.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/src/core/types.ts) via [src/github/github-hydration.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/src/github/github-hydration.ts). Focused coverage was added in [src/github/github-review-signals.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/src/github/github-review-signals.test.ts) and [src/github/github-pull-request-hydrator.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/src/github/github-pull-request-hydrator.test.ts).

Checkpoint commit: `1074204` (`Record CodeRabbit draft-skip review signals`). Draft PR [#481](https://github.com/TommyKammy/codex-supervisor/pull/481) is now open from `codex/issue-478` to `main`. The only remaining workspace change is the issue journal update plus the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Recorded CodeRabbit draft-skip comments as `draftSkipAt`, hydrated that onto PRs, added focused tests, ran `npm ci`, and verified `npm run build`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #481 for CI or review feedback, then hand off to the next pull-request-state slice once this checkpoint is accepted.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit draft-skip issue comments were being treated as generic informational noise, so the configured-bot lifecycle could not distinguish “provider skipped because PR was draft” from “provider has not produced any meaningful signal yet.”
- What changed: Added a focused `draftSkipAt` signal to configured-bot review summaries, detected via a dedicated draft-skip heuristic, hydrated it onto `GitHubPullRequest.configuredBotDraftSkipAt`, and tightened the focused review-signal + hydrator tests so actionable arrivals still map to `arrived` while draft-skip stays separately recorded.
- Current blocker: none
- Next exact step: Monitor draft PR #481 and address any CI or review feedback before starting the next dependent slice.
- Verification gap: none locally; GitHub-side CI has not reported yet on PR #481.
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
- 2026-03-17: Pushed `codex/issue-478` to `origin` and opened draft PR #481 (`https://github.com/TommyKammy/codex-supervisor/pull/481`) after confirming there was no existing PR for the branch.
