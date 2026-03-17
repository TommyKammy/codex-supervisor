# Issue #457: CodeRabbit settled wait: add regression coverage for CI-green immediate-merge races

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/457
- Branch: codex/issue-457
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-457
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-457/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: fbb9436f33dd71ae1e07e6da2ed570386f6da379
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T07:23:35.577Z

## Latest Codex Summary
- Verified the committed weak-anchor CodeRabbit settled-wait coverage against the focused issue suite, restored local dependencies with `npm ci`, and confirmed the workspace is ready to publish as a draft PR if needed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit can emit later review-thread comments with missing `originalCommitOid`; those comments are still safe to treat as current-head activity only when a stronger CodeRabbit current-head observation already exists.
- What changed: Added focused review-signal and hydrator tests for weakly anchored CodeRabbit review comments, including a stale-head negative case; updated `inferConfiguredBotCurrentHeadObservedAt` to extend `currentHeadObservedAt` only for later CodeRabbit comments lacking `originalCommitOid` after a prior strong current-head observation.
- Current blocker: none
- Next exact step: Push `codex/issue-457`, open the draft PR, and hand back to the supervisor for the next phase.
- Verification gap: none for the focused review-signal, pull-request-state, supervisor lifecycle, hydrator, and build checks requested by the issue.
- Files touched: src/github/github-review-signals.ts; src/github/github-review-signals.test.ts; src/github/github-pull-request-hydrator.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: The weak-anchor extension is intentionally limited to CodeRabbit-authored review-thread comments that happen after a strong current-head observation; broadening that rule to other bots or comments without the prior observation would risk promoting stale history.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: `currentHeadObservedAt` stayed at the earlier summary-only current-head review and did not advance to a later CodeRabbit review-thread comment with `originalCommitOid: null`.
- Verification commands: `npx tsx --test src/github/github-review-signals.test.ts`; `npx tsx --test src/pull-request-state.test.ts`; `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts`; `npm ci`; `npx tsx --test src/github/github-pull-request-hydrator.test.ts`; `npm run build`.
