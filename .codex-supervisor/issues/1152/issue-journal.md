# Issue #1152: Rehydrate tracked PR-open issues from live GitHub facts at cycle start

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1152
- Branch: codex/issue-1152
- Workspace: .
- Journal: .codex-supervisor/issues/1152/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=3, repair=2)
- Last head SHA: f1ac2b44d6e0b22e921f31e0bd905bb9eeb74895
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853bbqc|PRRT_kwDORgvdZ853bbqd|PRRT_kwDORgvdZ853bbqh
- Repeated failure signature count: 1
- Updated at: 2026-03-28T04:58:05Z

## Latest Codex Summary
Addressed the three automated review findings on PR [#1157](https://github.com/TommyKammy/codex-supervisor/pull/1157) locally. The runtime change now skips degraded `getIssue()` fallback for non-blocked records inside blocked-state reconciliation, persists refreshed tracked-PR lifecycle sync fields when a same-head PR remains blocked, and the journal text now uses the official `GitHub` capitalization in prose.

Focused verification passed:
- `npx tsx --test src/run-once-cycle-prelude.test.ts`
- `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
- `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`

The worktree still has untracked supervisor runtime artifacts under `.codex-supervisor/`. Tracked changes are limited to the recovery implementation, regression tests, and this journal update.

Summary: Addressed PR #1157 review feedback by narrowing degraded tracked-PR issue refreshes, persisting blocked lifecycle sync fields, and fixing journal `GitHub` capitalization
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/run-once-cycle-prelude.test.ts` passed; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts` passed; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts` passed
Next action: Commit and push the review-fix checkpoint to PR #1157, then monitor GitHub re-review and CI on `codex/issue-1152`
Failure signature: PRRT_kwDORgvdZ853bbqc|PRRT_kwDORgvdZ853bbqd|PRRT_kwDORgvdZ853bbqh

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1157#discussion_r3004188989
- Details:
  - .codex-supervisor/issues/1152/issue-journal.md:40 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Use the official `GitHub` capitalization in journal text.** At Line 40 and Line 46, `github` should be `GitHub` for naming consistency in pro... url=https://github.com/TommyKammy/codex-supervisor/pull/1157#discussion_r3004188989
  - src/recovery-reconciliation.ts:1236 summary=_⚠️ Potential issue_ | _🟠 Major_ **Avoid probing `getIssue()` for every tracked PR in degraded mode.** This fallback runs before any state filtering, so an `issues=[]` cycle wi... url=https://github.com/TommyKammy/codex-supervisor/pull/1157#discussion_r3004188990
  - src/recovery-reconciliation.ts:1360 summary=_⚠️ Potential issue_ | _🟠 Major_ **Don't drop the refreshed lifecycle patch when the PR is still blocked.** This branch computes `reviewWaitPatch`, `copilotReview*` patches, an... url=https://github.com/TommyKammy/codex-supervisor/pull/1157#discussion_r3004188994

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR #1157 review threads are fully covered by a narrow recovery-reconciliation patch plus focused regression tests, and the branch is ready for an incremental review-fix push.
- What changed: I narrowed `reconcileRecoverableBlockedIssueStates` so degraded inventory fallback only probes `getIssue()` for blocked records, persisted fresh `last_head_sha` and sync-derived review/Copilot fields when a tracked PR remains blocked, added focused regression coverage for both paths, and corrected the journal prose to use `GitHub`.
- Current blocker: none.
- Next exact step: commit this review-fix checkpoint, push `codex/issue-1152`, and then watch PR #1157 for re-review or follow-up CI noise.
- Verification gap: none for the addressed review path. The same pre-existing non-fatal execution-metrics chronology warnings still appear in some suites, but they did not fail runs and were not changed here.
- Files touched: src/recovery-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; .codex-supervisor/issues/1152/issue-journal.md
- Rollback concern: low. The code change only narrows degraded issue refresh scope and persists already-computed blocked lifecycle sync fields.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Last focused commands: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
