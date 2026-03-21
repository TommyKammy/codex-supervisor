# Issue #759: Orphan age gate follow-up: base recent-orphan safety on actual worktree activity

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/759
- Branch: codex/issue-759
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 82a36368223f5b48a3e43b92d7d6f30f0e72debb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-21T02:21:27Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review on [src/recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-759/src/recovery-reconciliation.ts): missing dirty paths no longer get dropped when `statSync` hits `ENOENT`. The orphan recency check now falls back to the nearest existing ancestor mtime inside the worktree, so staged deletions still count as recent activity without relying on commit history timestamps.

I added focused staged-deletion regression coverage in [src/supervisor/supervisor-execution-cleanup.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-759/src/supervisor/supervisor-execution-cleanup.test.ts) and [src/supervisor/supervisor-diagnostics-status-selection.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-759/src/supervisor/supervisor-diagnostics-status-selection.test.ts). The tests now seed a tracked nested file, stage its deletion in the orphan worktree, keep the worktree directory timestamp stale, and verify the recent-orphan safeguard still preserves the workspace.

Commit `82a3636` is pushed on `codex/issue-759`, and the unresolved CodeRabbit thread `PRRT_kwDORgvdZ8512GIt` is resolved on PR #760 after the fix landed.

Summary: Added staged-deletion activity fallback for orphan recency, covered it with focused orphan prune regressions, pushed `82a3636`, and resolved the remaining bot thread on PR #760.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #760 for fresh review or CI regressions and only re-enter review-fix mode if a new thread appears

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread is valid because staged deletions are emitted by `git diff --name-only --cached -z`, but the orphan activity collector was still dropping those paths on `ENOENT`, which could misclassify a recently used orphan as old.
- What changed: `readOrphanedWorkspaceActivityTimestamp` now keeps the resolved workspace root once, updates `latestModifiedMs` through a helper, and on `ENOENT` walks up to the nearest existing ancestor under the worktree to reuse that directory mtime as the deletion-activity signal. Focused prune tests now cover staged deletion of a tracked nested file while the orphan worktree directory timestamp stays stale.
- Current blocker: none
- Next exact step: monitor PR #760 for fresh CI or review feedback now that commit `82a3636` is pushed and the last CodeRabbit thread is resolved.
- Verification gap: none for the requested scope; the targeted tests and build both pass locally after the staged-deletion regression update.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: reverting the new `ENOENT` fallback would reintroduce false-positive orphan pruning for orphan worktrees whose only recent activity is a staged deletion or removed nested path.
- Last focused command: `npm run build`
- Last focused failure: `staged-delete-empty-dir-stat-enoent`
- Last focused commands:
```bash
sed -n '1,260p' .codex-supervisor/issue-journal.md
sed -n '1,260p' src/recovery-reconciliation.ts
sed -n '654,785p' src/supervisor/supervisor-execution-cleanup.test.ts
sed -n '524,590p' src/supervisor/supervisor-diagnostics-status-selection.test.ts
npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm run build
git diff -- src/recovery-reconciliation.ts src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts .codex-supervisor/issue-journal.md
git status --short --branch
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
