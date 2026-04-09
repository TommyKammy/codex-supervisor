# Issue #1375: Refactor: split no-PR and workspace recovery flows out of recovery-reconciliation.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1375
- Branch: codex/issue-1375
- Workspace: .
- Journal: .codex-supervisor/issues/1375/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: e461d91bf017aac9b19a23670962bdde9ef8be3b
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855uOEJ
- Repeated failure signature count: 1
- Updated at: 2026-04-09T01:38:43.886Z

## Latest Codex Summary
Validated the remaining automated review thread on PR #1378 and confirmed the age-based done-workspace cleanup loop could still pass a stale `issue-*` directory without `.git` to `cleanupWorkspace`. Added the same `.git` guard used by the overflow pass and covered it with a regression test so tracked stale directories are skipped instead of being deleted.

Summary: Added the missing `.git` guard for age-based done-workspace cleanup and covered the stale-directory case with a regression test
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/recovery-reconciliation.test.ts --test-name-pattern 'done workspace|workspace cleanup'`; `npm run build`
Next action: commit the review fix, push `codex/issue-1375`, and monitor PR #1378 for any remaining review or CI follow-up
Failure signature: PRRT_kwDORgvdZ855uOEJ

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1378#discussion_r3055043962
- Details:
  - src/recovery-workspace-reconciliation.ts:372 summary=_⚠️ Potential issue_ | _🟠 Major_ **Guard the age-based cleanup with the same `.git` check.** The overflow pass only touches `existingDoneRecords`, but this loop reintroduces ev... url=https://github.com/TommyKammy/codex-supervisor/pull/1378#discussion_r3055043962

## Codex Working Notes
### Current Handoff
- Hypothesis: `src/recovery-reconciliation.ts` can be reduced to orchestration if workspace/orphan cleanup and failed no-PR reconciliation move behind dedicated modules without changing recovery events or state transitions.
- What changed: Added `src/recovery-workspace-reconciliation.ts` and `src/recovery-no-pr-reconciliation.ts`, rewired `src/recovery-reconciliation.ts` to delegate to them, and added `src/recovery-support.test.ts` to pin `classifyFailedNoPrBranchRecovery` directly. Fixed one transient regression by restoring the tracked-PR direct `getIssue` fallback before dispatching into the split paths. For the remaining PR #1378 review thread, added `hasWorkspaceGitDir()` in `src/recovery-workspace-reconciliation.ts` and reused it in both done-workspace cleanup passes so the age-based path now skips stale tracked directories without `.git`; added a regression test in `src/recovery-reconciliation.test.ts`.
- Current blocker: none
- Next exact step: commit and push the review fix to PR #1378, then verify whether the automated review thread clears or needs an explicit maintainer response.
- Verification gap: Full repository test suite was not run; current verification covered focused done-workspace cleanup tests and `npm run build`.
- Files touched: src/recovery-reconciliation.ts; src/recovery-workspace-reconciliation.ts; src/recovery-no-pr-reconciliation.ts; src/recovery-support.test.ts; src/recovery-reconciliation.test.ts; .codex-supervisor/issues/1375/issue-journal.md
- Rollback concern: low; risk is limited to recovery orchestration wiring and done-workspace cleanup eligibility, especially preserving the tracked-PR inventory-degraded `getIssue` fallback and exact recovery event semantics while skipping non-worktree stale directories.
- Last focused command: `npx tsx --test src/recovery-reconciliation.test.ts --test-name-pattern 'done workspace|workspace cleanup'`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
