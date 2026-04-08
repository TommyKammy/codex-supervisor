# Issue #1353: Bug: preserve same-PR repair continuation summary in failure context

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1353
- Branch: codex/issue-1353
- Workspace: .
- Journal: .codex-supervisor/issues/1353/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: cc21c5d169df9eca56d1f59d583bd696b853586a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T11:52:43.127Z

## Latest Codex Summary
- Preserved same-PR repair continuation summaries in exported failure context, added focused regression coverage for fix-blocked/manual-review continuation summaries and the null lane, and verified with targeted tests plus a full build.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `localReviewRepairContinuationFailureContext()` was rebuilding a generic local-review failure summary even when `localReviewRepairContinuationSummary()` had already produced a continuation-specific same-PR repair message.
- What changed: Updated the helper to preserve the continuation summary while keeping the existing failure signature/details, and added focused regressions for current-head `fix_blocked`, current-head `manual_review_blocked`, and the no-lane null case.
- Current blocker: none
- Next exact step: Commit the verified patch on `codex/issue-1353` and leave the branch ready for PR/draft PR handling.
- Verification gap: none for the requested local scope; targeted tests and `npm run build` passed.
- Files touched: `src/review-handling.ts`, `src/review-handling.test.ts`, `.codex-supervisor/issues/1353/issue-journal.md`
- Rollback concern: low; change only affects operator-facing failure-context summary selection for same-PR continuation lanes.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
