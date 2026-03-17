# Issue #456: CodeRabbit settled wait: strengthen comment-led current-head activity handling

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/456
- Branch: codex/issue-456
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-456
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-456/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f306a4c97c8d498d8dcd8da951c6391070dcc632
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T07:07:24.004Z

## Latest Codex Summary
- Added a focused reproducer for CodeRabbit review-thread comments without `originalCommitOid` that arrive after a safe current-head observation, then scoped the current-head extension rule to that CodeRabbit-only case and verified the settled-wait path with focused tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit can emit later review-thread comments with missing `originalCommitOid`; those comments are still safe to treat as current-head activity only when a stronger CodeRabbit current-head observation already exists.
- What changed: Added focused review-signal and hydrator tests for weakly anchored CodeRabbit review comments, including a stale-head negative case; updated `inferConfiguredBotCurrentHeadObservedAt` to extend `currentHeadObservedAt` only for later CodeRabbit comments lacking `originalCommitOid` after a prior strong current-head observation.
- Current blocker: none
- Next exact step: Commit the verified checkpoint and hand back to the supervisor for the next phase.
- Verification gap: none for the focused review-signal, pull-request-state, hydrator, and build checks requested by the issue.
- Files touched: src/github/github-review-signals.ts; src/github/github-review-signals.test.ts; src/github/github-pull-request-hydrator.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: The weak-anchor extension is intentionally limited to CodeRabbit-authored review-thread comments that happen after a strong current-head observation; broadening that rule to other bots or comments without the prior observation would risk promoting stale history.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: `currentHeadObservedAt` stayed at the earlier summary-only current-head review and did not advance to a later CodeRabbit review-thread comment with `originalCommitOid: null`.
- Verification commands: `npx tsx --test src/github/github-review-signals.test.ts`; `npx tsx --test src/github/github-pull-request-hydrator.test.ts`; `npx tsx --test src/pull-request-state.test.ts`; `npm ci`; `npm run build`.
