# Issue #727: Orphan cleanup safety gate: preserve locked or in-use orphaned workspaces automatically

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/727
- Branch: codex/issue-727
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a203c8431131ddd018bb3732c82b3d1bafe653f0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T21:10:35Z

## Latest Codex Summary
- Added a focused orphan-cleanup regression test proving `runOnce` pruned an orphaned issue worktree even when a live issue lock existed, then routed automatic orphan pruning through `inspectOrphanedWorkspacePruneCandidates()` so locked/in-use orphaned workspaces are skipped with deterministic reasons. Focused verification passed: `npx tsx --test src/lock.test.ts src/supervisor/supervisor-execution-cleanup.test.ts` and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: automatic orphan pruning should share the same lock/in-use eligibility classification already exposed by `inspectOrphanedWorkspacePruneCandidates()`, instead of deleting orphaned worktrees after only branch/target validation.
- What changed: added a focused `runOnce` regression test for a live orphan issue-lock skip in `src/supervisor/supervisor-execution-cleanup.test.ts`; updated `cleanupOrphanedIssueWorkspaces()` in `src/recovery-reconciliation.ts` to consume `inspectOrphanedWorkspacePruneCandidates()` and skip any non-`eligible` orphan with its deterministic reason.
- Current blocker: none
- Next exact step: commit the focused cleanup gate change, push `codex/issue-727`, and open a draft PR for issue `#727`.
- Verification gap: full repo test suite was not rerun; verification this turn is `npx tsx --test src/lock.test.ts src/supervisor/supervisor-execution-cleanup.test.ts` plus `npm run build`.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting these changes would restore automatic deletion of orphaned worktrees that still show live lock ownership, which is the safety gap this issue is meant to close.
- Last focused failure: `orphan-cleanup-prunes-live-locked-worktree`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-727/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-727/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts
npx tsx --test src/lock.test.ts src/supervisor/supervisor-execution-cleanup.test.ts
npm ci
npm run build
gh pr status
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
