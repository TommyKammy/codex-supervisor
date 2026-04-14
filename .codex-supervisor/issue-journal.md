# Issue #1522: Bug: merged issue closure gate skips suspicious done records with stale provenance

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1522
- Branch: codex/issue-1522
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6154a5e6dac2c30fee62f3899fa5c7713440175b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T09:30:52.069Z

## Latest Codex Summary
- Reproduced the stale-provenance gap with a focused `reconcileMergedIssueClosures()` test.
- Tightened merged-closure trust rules so closed `done` records only skip revalidation when they already carry recorded `merged_pr_convergence` provenance.
- Verified the stale-provenance repro, the bounded historical backlog behavior, and the TypeScript build.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `shouldRevalidateMergedIssueClosureRecord()` was trusting any closed `done` record with non-null `pr_number` and `last_head_sha`, so stale merged provenance without recorded convergence was skipped forever when the GitHub issue timestamp was older than the local terminal timestamp.
- What changed: Added a focused stale-provenance repro test; updated the merged-closure gate to keep records without recorded `merged_pr_convergence` eligible for reconciliation; marked the historical bounded-backlog fixtures as trusted converged records with explicit recovery provenance.
- Current blocker: none.
- Next exact step: commit the verified fix on `codex/issue-1522`.
- Verification gap: none for the issue-scoped checks; broader suite not run.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/run-once-cycle-prelude.test.ts`.
- Rollback concern: the new trust rule treats old closed `done` records without `merged_pr_convergence` recovery metadata as suspicious, so legacy state may re-enter reconciliation until repaired.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
