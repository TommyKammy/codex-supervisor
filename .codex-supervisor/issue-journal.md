# Issue #1522: Bug: merged issue closure gate skips suspicious done records with stale provenance

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1522
- Branch: codex/issue-1522
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 742a3c30e4d26985648097bb950dbcdf746433a3
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856xSZQ
- Repeated failure signature count: 1
- Updated at: 2026-04-14T09:42:25.160Z

## Latest Codex Summary
Implemented and verified the stale merged-provenance fix on `codex/issue-1522`. The gate in [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts:344) now treats closed `done` records as safely skippable only when they already carry recorded `merged_pr_convergence` provenance; otherwise they remain eligible for merged-closure reconciliation even if the GitHub issue `updatedAt` is older than the local terminal timestamp. I added the narrow repro in [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts:3584) and kept the bounded-backlog coverage aligned in [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts:311).

The work is committed as `742a3c3` (`Revalidate stale merged closure provenance`), pushed to `origin/codex/issue-1522`, and a draft PR is open at https://github.com/TommyKammy/codex-supervisor/pull/1523. The worktree is otherwise clean apart from existing untracked supervisor artifacts under `.codex-supervisor/`.

Summary: Fixed merged-closure revalidation so stale closed `done` provenance without recorded convergence is no longer skipped forever; added focused regression coverage; committed and opened draft PR #1523
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`
Next action: Let PR #1523 run CI and address any review or check failures if they appear
Failure signature: PRRT_kwDORgvdZ856xSZQ

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1523#discussion_r3078535348
- Details:
  - src/recovery-reconciliation.ts:369 summary=_⚠️ Potential issue_ | _🟠 Major_ **Persist repaired provenance even when the done patch is otherwise unchanged.** Line 367 correctly forces suspicious records into revalidation... url=https://github.com/TommyKammy/codex-supervisor/pull/1523#discussion_r3078535348

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread was valid because `reconcileMergedIssueClosures()` re-entered suspicious closed `done` records, but it only persisted a repair when `doneResetPatch()` changed structural fields; records whose stored PR/head already matched never backfilled `merged_pr_convergence` provenance and kept re-entering reconciliation forever.
- What changed: Kept the earlier suspicious-record revalidation gate and added a persistence backfill in `reconcileMergedIssueClosures()` so matching PR/head records still write `merged_pr_convergence` recovery metadata once; added a focused regression covering the "correct PR/head, wrong recovery reason" case.
- Current blocker: none.
- Next exact step: commit and push the review fix on `codex/issue-1522`, then refresh PR #1523.
- Verification gap: none for the issue-scoped checks; broader suite not run.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Rollback concern: the new trust rule treats old closed `done` records without `merged_pr_convergence` recovery metadata as suspicious, so legacy state may re-enter reconciliation until repaired.
- Last focused commands: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
