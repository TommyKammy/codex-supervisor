# Issue #552: Recovery visibility: record lifecycle-driven recovery reasons when tracked PRs resume

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/552
- Branch: codex/issue-552
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: c2f47d5ce306f8a732687c2c380e3285b8c743ca
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T14:54:41Z

## Latest Codex Summary
Recorded deterministic recovery metadata for lifecycle-driven tracked-PR resumptions in [src/recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-552/src/recovery-reconciliation.ts). Failed records resumed by `reconcileStaleFailedIssueStates()` now persist `last_recovery_reason`/`last_recovery_at`, distinguishing `tracked_pr_head_advanced` from same-head `tracked_pr_lifecycle_recovered`.

Added the focused repro in [src/supervisor/supervisor-recovery-reconciliation.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-552/src/supervisor/supervisor-recovery-reconciliation.test.ts) for a repeated-failure stop followed by tracked PR head advancement, reran the focused verification on the checkpoint commit, pushed `codex/issue-552`, and opened draft PR [#569](https://github.com/TommyKammy/codex-supervisor/pull/569).

Verification passed with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts` and `npm run build`. I had to run `npm install` first because the workspace was missing `tsc`. The only remaining worktree noise is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Persisted deterministic tracked-PR resume recovery reasons, reran focused verification, and opened draft PR #569
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts`; `npm run build`
Failure signature: none
Next action: monitor draft PR #569 and address review or CI feedback if it appears

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileStaleFailedIssueStates()` already resumed failed tracked-PR records based on fresh lifecycle facts, but it did not persist a recovery reason, so later status/explain work had no canonical source for why the record resumed.
- What changed: added a focused regression covering a repeated-failure stop followed by tracked PR head advancement, then introduced deterministic recovery-reason generation for tracked-PR resumptions with distinct `tracked_pr_head_advanced` and `tracked_pr_lifecycle_recovered` reasons and persisted them via `applyRecoveryEvent(...)`.
- Current blocker: none
- Next exact step: keep draft PR #569 ready and respond to review or CI feedback if any appears.
- Verification gap: broader full-suite verification has not been run.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: reverting the recovery metadata change would make lifecycle-driven resumptions indistinguishable from other recovery paths in stored state again.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts`; `npm run build`
### Scratchpad
- 2026-03-18 (JST): Reran the focused recovery/lifecycle tests and `npm run build`, pushed `codex/issue-552`, and opened draft PR #569.
- 2026-03-18 (JST): Added a narrow repro in `src/supervisor/supervisor-recovery-reconciliation.test.ts` for a failed record with `repeated_failure_signature_count=3` that resumes after tracked PR `#191` advances from `head-old-191` to `head-new-191`; the initial focused failure was `last_recovery_reason === null`.
- 2026-03-18 (JST): Implemented deterministic tracked-PR resume recovery reasons in `src/recovery-reconciliation.ts`, distinguishing head-advance resumptions from same-head fresh-facts resumptions, and persisted them with `applyRecoveryEvent(...)`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; ran `npm install` to restore the local toolchain, then reran focused tests and the build successfully.
