# Issue #552: Recovery visibility: record lifecycle-driven recovery reasons when tracked PRs resume

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/552
- Branch: codex/issue-552
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6ac36af74dcd8bd34f247d8ff41432408efa0613
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T16:05:00+09:00

## Latest Codex Summary
Recorded lifecycle-driven recovery reasons when tracked PR facts resume previously failed records. Added focused repro coverage in [src/supervisor/supervisor-recovery-reconciliation.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-552/src/supervisor/supervisor-recovery-reconciliation.test.ts) for a repeated-failure stop followed by tracked PR head advancement, then updated [src/recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-552/src/recovery-reconciliation.ts) so `reconcileStaleFailedIssueStates()` persists deterministic `last_recovery_reason` and `last_recovery_at` metadata on resume.

Focused verification passed with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts` and `npm run build` after restoring local dependencies with `npm install`.

Summary: Persisted deterministic lifecycle-driven recovery reasons when tracked PR state resumes failed records, with focused head-advance regression coverage and a passing build.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts`; `npm run build`
Failure signature: none
Next action: Review the diff, checkpoint-commit this recovery slice, and open/update the draft PR if needed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileStaleFailedIssueStates()` already resumed failed tracked-PR records based on fresh lifecycle facts, but it did not persist a recovery reason, so later status/explain work had no canonical source for why the record resumed.
- What changed: added a focused regression covering a repeated-failure stop followed by tracked PR head advancement, then introduced deterministic recovery-reason generation for tracked-PR resumptions with distinct `tracked_pr_head_advanced` and `tracked_pr_lifecycle_recovered` reasons and persisted them via `applyRecoveryEvent(...)`.
- Current blocker: none
- Next exact step: create a checkpoint commit for the recovery metadata change and keep the branch ready for PR/update work.
- Verification gap: broader full-suite verification has not been run.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: reverting the recovery metadata change would make lifecycle-driven resumptions indistinguishable from other recovery paths in stored state again.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts`; `npm run build`

### Scratchpad
- 2026-03-18 (JST): Added a narrow repro in `src/supervisor/supervisor-recovery-reconciliation.test.ts` for a failed record with `repeated_failure_signature_count=3` that resumes after tracked PR `#191` advances from `head-old-191` to `head-new-191`; the initial focused failure was `last_recovery_reason === null`.
- 2026-03-18 (JST): Implemented deterministic tracked-PR resume recovery reasons in `src/recovery-reconciliation.ts`, distinguishing head-advance resumptions from same-head fresh-facts resumptions, and persisted them with `applyRecoveryEvent(...)`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; ran `npm install` to restore the local toolchain, then reran focused tests and the build successfully.
