# Issue #1293: [codex] Fetch origin/default branch once per reconciliation pass

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1293
- Branch: codex/issue-1293
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7f5f7c9bc1c45fb819c6deaf7ed8e6345472ff1f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-04T00:03:35.318Z

## Latest Codex Summary
- Moved failed no-PR default-branch fetches to a shared per-pass boundary inside stale failed reconciliation, added regression coverage for one-fetch-per-pass reuse and shared-fetch fail-closed behavior, and verified with the focused reconciliation suite plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileStaleFailedIssueStates` was re-fetching `origin/<defaultBranch>` once per eligible failed no-PR record because the fetch lived inside `classifyFailedNoPrBranchRecovery`, so multiple stale no-PR records in one pass repeated the same remote fetch.
- What changed: Added a shared per-pass `ensureOriginDefaultBranchFetched` promise in `reconcileStaleFailedIssueStates`, routed failed no-PR branch classification through that shared fetch, and added focused regression tests for one-fetch-per-pass reuse plus shared-fetch fail-closed behavior.
- Current blocker: none
- Next exact step: Commit the reconciliation/test updates on `codex/issue-1293` and hand back a clean verified checkpoint.
- Verification gap: none for the requested focused reconciliation coverage and build; the reconciliation test file still emits known execution-metrics chronology warnings in unrelated tests without failing.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: Failed no-PR reconciliation now reuses one shared default-branch fetch result per pass, so any future change that expects per-record fetch retries inside the same pass would need an explicit redesign.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
