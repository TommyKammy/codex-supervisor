# Issue #468: CodeRabbit initial grace wait: pause briefly after CI turns green before merge progression

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/468
- Branch: codex/issue-468
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-468
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-468/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 36051b281154d7402f6c986f35ca2c8a67a9b227
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T10:38:30.734Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit needed a separate startup grace window keyed off `currentHeadCiGreenAt`; the existing settled wait only covered post-observation quiet time and could not pause merge progression while the provider was still silent.
- What changed: Added `configuredBotInitialGraceWaitSeconds` with a default of 90 seconds, used it only for CodeRabbit when required checks are green and no current-head provider activity has been observed, kept the settled-wait handoff after activity begins, and surfaced the active initial-grace window in supervisor status/output.
- Current blocker: none
- Next exact step: Stage the focused implementation and test updates, then create a checkpoint commit on `codex/issue-468`.
- Verification gap: none for local focused verification; remote CI has not run yet.
- Files touched: `src/pull-request-state.ts`, `src/supervisor/supervisor-status-review-bot.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, focused tests, `src/core/config.ts`, `src/core/types.ts`, `supervisor.config.coderabbit.json`, `docs/configuration.md`
- Rollback concern: defaulting the new CodeRabbit-only grace to 90 seconds changes merge timing for CodeRabbit-configured repos immediately; reverting means removing the config default and initial-grace branch together.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: required current-head CI completion metadata was absent from configured-bot hydration, so no stable `currentHeadCiGreenAt` value existed for later CodeRabbit provider-start wait logic.
- Focused derivation rule: use the latest completion timestamp among required current-head checks, but only when every required current-head check on the tracked head is already passing/skipping; otherwise leave the field null.
- Verification commands: `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts`; `npx tsx --test src/pull-request-state-provider-waits.test.ts`; `npm ci`; `npm run build`.
- Local failure resolved: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree was missing `node_modules`; `npm ci` restored the local toolchain and the acceptance build passed afterward.
- 2026-03-17: Focused reproducer was `inferStateFromPullRequest` returning `ready_to_merge` instead of `waiting_ci` when `currentHeadCiGreenAt=2026-03-13T02:05:00Z`, CodeRabbit was configured, and no `configuredBotCurrentHeadObservedAt` existed. The new initial grace wait covers that silent-provider window and hands off to the existing settled wait once `configuredBotCurrentHeadObservedAt` appears.
