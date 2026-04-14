# Issue #1520: Bug: run-once prelude revalidates historical closed issues via merged_issue_closures on every cycle

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1520
- Branch: codex/issue-1520
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 97386e4ff2efd63260a4b66185c4471f357570f1
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T09:02:17.448Z

## Latest Codex Summary
- Added a freshness gate to `reconcileMergedIssueClosures()` so ordinary prelude cycles skip historical terminal closed records unless the issue is active, still non-terminal locally, or GitHub updated the closed issue after the local terminal record.
- Added focused regression coverage at both the reconciliation layer and `runOnceCyclePrelude` layer to prove a 160-record historical closed backlog no longer triggers 160 merged-closure GraphQL lookups.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `merged_issue_closures` was O(history) because it called `getMergedPullRequestsClosingIssue()` for every `CLOSED` issue record, even when the local record was already stably `done` and GitHub had not changed since the terminal write.
- What changed: Added `shouldRevalidateMergedIssueClosureRecord()` in `src/recovery-reconciliation.ts` and used it to skip historical `done` records unless they are active, non-terminal, or the GitHub issue `updatedAt` is newer than the latest local terminal timestamp. Added bounded-lookup regressions in `src/supervisor/supervisor-recovery-reconciliation.test.ts` and `src/run-once-cycle-prelude.test.ts`.
- Current blocker: none
- Next exact step: Commit the bounded merged-closure fix on `codex/issue-1520` and prepare the branch for PR creation/update.
- Verification gap: No PR/CI verification yet; local focused tests and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/run-once-cycle-prelude.test.ts`
- Rollback concern: Low. The gate only skips revalidation for stale terminal closed records; active, non-terminal, and newly changed closed issues still run the existing reconciliation path.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
