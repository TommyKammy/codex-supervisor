# Issue #1442: Comment on GitHub issues when execution-ready metadata is missing

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1442
- Branch: codex/issue-1442
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 23413175a88824ea9f1b3b81ba83b97d1df66eb5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T01:09:30.422Z

## Latest Codex Summary
- Added machine-managed requirements-blocker issue comments for execution-ready metadata failures, updated issue-lint repair guidance to the canonical `## Execution order` form, and clear the sticky blocker comment when metadata becomes execution-ready again.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Requirements-blocked issues were only updating local state/journal; the supervisor had no owned GitHub issue-comment surface for actionable metadata blockers, and issue-lint guidance still suggested the legacy single-line `Execution order:` form.
- What changed: Added `src/requirements-blocker-issue-comment.ts`; wired requirements blocker comment publish/update into `resolveRunnableIssueContext`; wired comment clearing into `reconcileRecoverableBlockedIssueStates`; added GitHub issue-comment GraphQL reads via `getIssueComments`; refactored issue-lint DTO creation to share logic and updated repair guidance to the canonical `## Execution order` section wording.
- Current blocker: none
- Next exact step: Review the final diff, commit the checkpoint on `codex/issue-1442`, and leave the branch ready for PR/draft PR handling.
- Verification gap: No full suite run yet; focused coverage for guidance, publish/dedupe/update, clear-on-recovery, and `npm run build` are green.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/requirements-blocker-issue-comment.ts`, `src/run-once-issue-selection.ts`, `src/recovery-reconciliation.ts`, `src/github/github-review-surface.ts`, `src/github/github.ts`, `src/supervisor/supervisor-selection-issue-lint.ts`, related focused tests.
- Rollback concern: Low to moderate; behavior change is limited to requirements-blocked issue comment publication/clearance and issue-lint repair text, but GitHub issue-comment lookup now depends on a new GraphQL issue comments path.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
