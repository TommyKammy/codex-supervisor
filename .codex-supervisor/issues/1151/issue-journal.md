# Issue #1151: Expose GitHub-versus-local tracked PR mismatches in doctor status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1151
- Branch: codex/issue-1151
- Workspace: .
- Journal: .codex-supervisor/issues/1151/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: f7d539fc4adadc9d0fc6bf571efb65fa600f1a8c
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853b-df
- Repeated failure signature count: 1
- Updated at: 2026-03-28T07:08:04.000Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review thread on PR [#1161](https://github.com/TommyKammy/codex-supervisor/pull/1161) by making explain-side tracked-PR mismatch hydration degrade gracefully on transient GitHub failures.

Code changes this turn were limited to [src/supervisor/supervisor-selection-issue-explain.ts](src/supervisor/supervisor-selection-issue-explain.ts), where mismatch hydration now falls back to null mismatch fields instead of throwing, and [src/supervisor/supervisor-diagnostics-explain.test.ts](src/supervisor/supervisor-diagnostics-explain.test.ts), which adds a regression test for the failure path. I also updated this issue journal.

Verification that passed:
- `npm run build`
- `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts`

Summary: Addressed the explain hydration review thread by degrading tracked-PR mismatch enrichment gracefully when GitHub checks or review-thread reads fail, with focused regression coverage and a clean build
State hint: addressing_review
Blocked reason: none
Tests: `npm run build`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts`
Next action: Re-check PR `#1161` for any remaining unresolved review threads after the pushed review-fix commit `e941dbc`
Failure signature: PRRT_kwDORgvdZ853b-df

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1161#discussion_r3004389348
- Details:
  - Review-fix commit `e941dbc` is pushed to `codex/issue-1151`: transient `getChecks` or `getUnresolvedReviewThreads` failures now suppress tracked-PR mismatch enrichment instead of breaking `buildIssueExplainDto`; GitHub thread resolution still depends on reviewer/tool refresh.

## Codex Working Notes
### Current Handoff
- Hypothesis: Operator diagnostics need a shared tracked-PR comparison against live GitHub PR lifecycle facts, not just persisted local state, to expose stale `blocked`/`failed` records.
- What changed: Wrapped explain-only mismatch hydration in a guarded `Promise.all` so transient GitHub failures leave `trackedPrMismatchSummary`/`recoveryGuidance` null instead of throwing, and added a focused explain regression test for that failure path.
- Current blocker: None.
- Next exact step: Re-check PR `#1161` after the pushed review-fix commit `e941dbc` and confirm the CodeRabbit thread is no longer actionable.
- Verification gap: Broad `npm test` was not rerun this turn because the review fix is scoped to explain-only mismatch hydration; the focused diagnostics suites and `npm run build` passed.
- Files touched: src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; .codex-supervisor/issues/1151/issue-journal.md
- Rollback concern: Low; the change is additive diagnostics-only logic that does not mutate tracked state.
- Last focused command: git push github codex/issue-1151
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
