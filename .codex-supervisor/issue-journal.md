# Issue #728: Orphan cleanup age gate: preserve recent orphaned workspaces until they age out

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/728
- Branch: codex/issue-728
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7c121e78f96818fc49d5e051d1d9f20ff6028cf6
- Blocked reason: none
- Last failure signature: orphan-age-gate-coupled-to-done-cleanup
- Repeated failure signature count: 0
- Updated at: 2026-03-20T21:34:38Z

## Latest Codex Summary
- Added a dedicated orphan-workspace age gate so automatic orphan pruning preserves recent orphaned worktrees even when tracked done-workspace cleanup is disabled.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: orphan auto-prune needs its own age threshold because reusing `cleanupDoneWorkspacesAfterHours` drops the orphan grace period whenever tracked done cleanup is disabled.
- What changed: added a focused `runOnce` regression that preserves a recent orphan while still keeping an aged orphan pruneable in `src/supervisor/supervisor-execution-cleanup.test.ts`; introduced `cleanupOrphanedWorkspacesAfterHours` in config parsing and docs; updated `inspectOrphanedWorkspacePruneCandidates()` in `src/recovery-reconciliation.ts` to classify recent orphans against the dedicated threshold instead of `cleanupDoneWorkspacesAfterHours`.
- Current blocker: none
- Next exact step: commit the focused orphan age-gate change on `codex/issue-728`, then open or update a draft PR if one does not already exist.
- Verification gap: targeted tests and build passed, but the full repo test suite was not rerun.
- Files touched: `src/core/config.ts`, `src/core/types.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `docs/configuration.md`, `docs/examples/atlaspm.md`, `docs/examples/atlaspm.supervisor.config.example.json`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting these changes would couple orphan pruning back to tracked done-workspace retention and let recent orphaned workspaces be auto-pruned immediately when done cleanup is disabled.
- Last focused command: `npm run build`
- Last focused failure: `orphan-age-gate-coupled-to-done-cleanup`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-728/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-728/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts
npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts src/run-once-cycle-prelude.test.ts
npx tsx --test src/doctor.test.ts
npm ci
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
