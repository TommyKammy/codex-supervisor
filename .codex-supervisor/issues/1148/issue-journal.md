# Issue #1148: Do not block auto-merge on resolved-state journal-only bot threads when PR is green

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1148
- Branch: codex/issue-1148
- Workspace: .
- Journal: .codex-supervisor/issues/1148/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a5d6e1652a01ab0ae3310b85b55e6f0827ebb1bc
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T03:34:48.028Z

## Latest Codex Summary
- Added a narrow PR-state exception for configured-bot threads that only touch `.codex-supervisor/**/issue-journal.md` when the PR is otherwise clean and mergeable, required checks are green, and the current-head CodeRabbit status context is `SUCCESS`.
- Added focused regression coverage for the allowed journal-only case plus blocked non-journal and non-green cases, and added hydration/signal support for the current-head configured-bot status state.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The blocker is too broad because any unresolved configured-bot thread currently forces `manual_review`, even when the only remaining bot thread is on `.codex-supervisor/**/issue-journal.md` and CodeRabbit already reports the current head as successful.
- What changed: Added `configuredBotCurrentHeadStatusState` hydration/signal plumbing, filtered journal-only configured-bot threads out of blocking only when the PR is `MERGEABLE` and `CLEAN`, checks are all passing, and the current-head configured-bot status state is `SUCCESS`, and added focused policy tests for allowed and blocked variants.
- Current blocker: none
- Next exact step: Review the diff, stage the implementation and journal update, and create a checkpoint commit on `codex/issue-1148`.
- Verification gap: Full repo-wide `npm test` has not been run; focused PR-state and hydrator/regression slices plus `npm run build` passed.
- Files touched: src/pull-request-state.ts; src/pull-request-state-policy.test.ts; src/github/github-review-signals.ts; src/github/github-review-signals.test.ts; src/github/github-hydration.ts; src/github/github-pull-request-hydrator.ts; src/core/types.ts; .codex-supervisor/issues/1148/issue-journal.md
- Rollback concern: The new exception is intentionally narrow but it now relies on hydrated current-head status-context state; regressions would most likely come from missing or malformed provider status metadata.
- Last focused command: npx tsx --test src/pull-request-state-thread-reprocessing.test.ts src/github/github-pull-request-hydrator.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-28: Focused verification passed: `npx tsx --test src/pull-request-state-policy.test.ts src/github/github-review-signals.test.ts`, `npx tsx --test src/pull-request-state-thread-reprocessing.test.ts src/github/github-pull-request-hydrator.test.ts`, and `npm run build`.
