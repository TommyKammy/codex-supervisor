# Issue #469: CodeRabbit initial grace wait: record the current-head CI-green timestamp for provider-start waiting

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/469
- Branch: codex/issue-469
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-469
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-469/.codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1c6bc037675a3da061798ece74d4ceca6fca84e1
- Blocked reason: none
- Last failure signature: missing-current-head-ci-green-at
- Repeated failure signature count: 0
- Updated at: 2026-03-17T10:16:58Z

## Latest Codex Summary
- Added current-head CI-green timestamp derivation for required checks in configured-bot hydration/review-signal summaries and exposed it on hydrated pull requests without changing merge-state behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
- Hypothesis: the initial provider-start grace window needs a stable current-head CI-ready timestamp derived from required current-head checks, and that data can be exposed via configured-bot hydration without affecting current merge decisions.
- What changed: Added `currentHeadCiGreenAt` to configured-bot review summaries and hydrated PRs; extended the GraphQL hydration query to collect required `StatusContext` and `CheckRun` metadata on the current head; derived the timestamp as the latest completion among required current-head checks only when every required current-head check is already passing/skipping.
- Current blocker: none
- Next exact step: review the diff, commit the checkpoint on `codex/issue-469`, and use it as the base for the later provider-start grace-window behavior.
- Verification gap: none for the recorded timestamp slice; focused hydration/review-signal tests, pull-request-state compatibility coverage, and `npm run build` all pass locally after reinstalling dependencies.
- Files touched: src/core/types.ts; src/github/github-hydration.ts; src/github/github-pull-request-hydrator.ts; src/github/github-review-signals.ts; src/github/github-pull-request-hydrator.test.ts; src/github/github-review-signals.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: `currentHeadCiGreenAt` intentionally stays observational for now; later grace-window logic should use it only for the matching current head and avoid falling back to stale-head required checks or optional checks.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: required current-head CI completion metadata was absent from configured-bot hydration, so no stable `currentHeadCiGreenAt` value existed for later CodeRabbit provider-start wait logic.
- Focused derivation rule: use the latest completion timestamp among required current-head checks, but only when every required current-head check on the tracked head is already passing/skipping; otherwise leave the field null.
- Verification commands: `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts`; `npx tsx --test src/pull-request-state-provider-waits.test.ts`; `npm ci`; `npm run build`.
- Local failure resolved: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree was missing `node_modules`; `npm ci` restored the local toolchain and the acceptance build passed afterward.
