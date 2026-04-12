# Issue #1456: Surface preserved partial-work incidents in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1456
- Branch: codex/issue-1456
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: c48946c41610f49e1584285f45db3a524d870732
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856WZIX
- Repeated failure signature count: 1
- Updated at: 2026-04-12T07:09:52.507Z

## Latest Codex Summary
Summary: Pushed `codex/issue-1456`, opened draft PR #1459 at https://github.com/TommyKammy/codex-supervisor/pull/1459, and updated the issue journal handoff to reflect the live PR checkpoint.
State hint: pr_open
Blocked reason: none
Tests: Not rerun this turn; prior checkpoint verification remains `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`, `npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts`, `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts`, `npx tsx --test src/recovery-support.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`, and `npm run build`
Next action: Watch draft PR #1459 for CI and review feedback, then address any failing checks or comments
Failure signature: PRRT_kwDORgvdZ856WZIX

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1459#discussion_r3069131661
- Details:
  - src/recovery-support.ts:197 summary=_⚠️ Potential issue_ | _🟠 Major_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 5587 --- 🏁 Script executed: Repository: TommyK... url=https://github.com/TommyKammy/codex-supervisor/pull/1459#discussion_r3069131661

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review blocker was valid because failed no-PR recovery treated `??` porcelain entries as preserved tracked work; filtering those entries only at preserved-work aggregation keeps manual-review blocking intact while restoring the tracked-work distinction.
- What changed: Added `parseGitStatusPorcelainV1Entries` so failed no-PR recovery can inspect porcelain status codes, filtered `??` entries out of `preservedTrackedFiles` while keeping workspace dirtiness checks unchanged, added an untracked-only regression test, committed the review fix as `24b41d4`, pushed `codex/issue-1456`, replied on PR #1459, and resolved the CodeRabbit thread.
- Current blocker: none
- Next exact step: Refresh PR #1459 facts on the next supervisor cycle and confirm no further review or CI blockers remain.
- Verification gap: Did not rerun the broad `npm test -- ...` package script because it executes the whole suite; reran focused `npx tsx --test src/core/git-workspace-helpers.test.ts src/recovery-support.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-rendering.test.ts` plus `npm run build`.
- Files touched: src/core/git-workspace-helpers.ts; src/recovery-support.ts; src/recovery-no-pr-reconciliation.ts; src/supervisor/supervisor-preserved-partial-work.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-detailed-status-assembly.ts; src/recovery-support.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/supervisor/supervisor-selection-issue-explain.test.ts; src/supervisor/supervisor-status-rendering.test.ts; src/backend/supervisor-http-server.test.ts; src/backend/webui-dashboard-browser-smoke.test.ts; src/supervisor/supervisor-service.test.ts
- Rollback concern: The new `SupervisorExplainDto.preservedPartialWorkSummary` field required stub updates in backend/service tests; any downstream handwritten DTO fixture will now need the nullable field.
- Last focused command: gh api graphql -f query='mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } } }' -f threadId=PRRT_kwDORgvdZ856WZIX
### Scratchpad
- 2026-04-12: Addressed PRRT_kwDORgvdZ856WZIX by excluding `??` entries from failed no-PR `preservedTrackedFiles`; untracked-only work still yields `manual_review_required` but no longer advertises preserved tracked partial work.
- 2026-04-12: Posted follow-up on PR #1459 via `gh api` because the GitHub app lacked permission to reply to the inline comment, then resolved the review thread directly with GraphQL.
