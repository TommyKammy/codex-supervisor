# Issue #455: CodeRabbit settled wait: evaluate and safely incorporate status-context activity

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/455
- Branch: codex/issue-455
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-455
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-455/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ad9eb685ee9fe2986af3664c98215da8e7c6d460
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T06:51:11.897Z

## Latest Codex Summary
- Safely incorporated current-head CodeRabbit status-context activity into configured-bot settled-wait observation by hydrating only latest-commit `StatusContext` entries and filtering to CodeRabbit-owned/signaled contexts; stale-head observations remain excluded.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit can emit current-head status-context activity before comments/reviews; if hydrated from the PR head commit only, it is safe to treat as settled-wait activity.
- What changed: Added status-context support to configured-bot review summary and hydrator GraphQL, plus focused tests covering current-head inclusion and stale-head exclusion.
- Current blocker: none
- Next exact step: Commit the verified checkpoint and hand back to the supervisor for the next phase.
- Verification gap: none for the focused hydration/review-signal, pull-request-state, and build checks requested by the issue.
- Files touched: src/github/github-review-signals.ts; src/github/github-review-signals.test.ts; src/github/github-hydration.ts; src/github/github-pull-request-hydrator.ts; src/github/github-pull-request-hydrator.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: The new signal intentionally trusts only latest-commit `StatusContext` data and CodeRabbit-owned/signaled contexts; widening beyond that would risk ambiguous provider activity.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
