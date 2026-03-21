# Issue #759: Orphan age gate follow-up: base recent-orphan safety on actual worktree activity

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/759
- Branch: codex/issue-759
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 22ac439304533c4a09b12541070d2bb6dc6edf6e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T02:04:44Z

## Latest Codex Summary
- Reproduced the orphan recency bug with focused prune tests that keep the orphan workspace directory mtime stale while updating a file inside the worktree. Fixed orphan recency classification to consider git-reported dirty-path mtimes inside the worktree, and updated the focused prune tests to assert recent internal file activity instead of parent-directory mtimes. Focused tests pass and `npm run build` passes after installing local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: orphan recency classification was still trusting the orphan workspace directory mtime, so recently edited files inside an orphan worktree were invisible to the age gate and the worktree became prune-eligible too early.
- What changed: `inspectOrphanedWorkspacePruneCandidates` now derives `modifiedAt` from the newest available activity timestamp across the workspace directory and git-reported dirty paths inside the orphan worktree. Focused prune tests now simulate recent internal file activity while forcing the worktree directory mtime to stay old.
- Current blocker: none
- Next exact step: stage the orphan-recency fix and focused tests, commit the checkpoint on `codex/issue-759`, and open or update the PR if needed.
- Verification gap: none for the requested scope; the required focused tests and build both passed after dependencies were installed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: reverting the dirty-path activity timestamp logic would reintroduce false-positive orphan pruning for recently edited orphan worktrees whose parent directory mtimes stayed old.
- Last focused command: `npm run build`
- Last focused failure: `orphan-recency-uses-workspace-dir-mtime`
- Last focused commands:
```bash
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "orphan|recent-orphan|mtime|worktree activity|auto-prune|prune" src
sed -n '120,320p' src/recovery-reconciliation.ts
sed -n '640,780p' src/supervisor/supervisor-execution-cleanup.test.ts
sed -n '500,610p' src/supervisor/supervisor-diagnostics-status-selection.test.ts
git diff -- src/recovery-reconciliation.ts src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm ci
npm run build
git status --short --branch
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
