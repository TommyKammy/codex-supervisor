# Issue #1522: Bug: merged issue closure gate skips suspicious done records with stale provenance

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1522
- Branch: codex/issue-1522
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=1)
- Last head SHA: 9e34edb601fd6e0f0abd64cdec05f9206dbe4632
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856xSZQ
- Repeated failure signature count: 1
- Updated at: 2026-04-14T09:52:06.449Z

## Latest Codex Summary
Patched [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts:654) so merged-closure reconciliation now writes a `merged_pr_convergence` recovery event even when the stored `pr_number` and `last_head_sha` already match the satisfying merged PR. That prevents suspicious closed `done` records from re-entering the expensive reconciliation path forever without ever converging locally.

Added a focused regression in [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts:3666) for the exact review case: correct merged PR metadata, stale recovery provenance, older GitHub `updatedAt`, and a required one-time backfill. Verified with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts` and `npm run build`, then committed and pushed as `9e34edb` on `codex/issue-1522`. I did not post a GitHub reply or resolve the review thread.

Summary: Backfilled merged-closure convergence provenance for already-matching done records, added a regression test for the review case, and pushed commit `9e34edb` to PR #1523
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`
Next action: Refresh PR #1523 review state and, if desired, reply to or resolve the remaining automated review thread based on commit `9e34edb`
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
- What changed: Verified the CodeRabbit major finding is already fixed on `HEAD` via the `needsMergedConvergenceBackfill` write path, then tightened the stale-provenance regression fixture to set `last_recovery_reason: null` explicitly so future `createRecord()` default changes cannot accidentally make the test record trusted.
- Current blocker: none.
- Next exact step: commit and push the explicit test-fixture follow-up on `codex/issue-1522`, then refresh PR #1523 and decide whether to reply to or resolve the still-open CodeRabbit thread manually.
- Verification gap: none for the issue-scoped checks; broader suite not run.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Rollback concern: the new trust rule treats old closed `done` records without `merged_pr_convergence` recovery metadata as suspicious, so legacy state may re-enter reconciliation until repaired.
- Last focused command:
- Last focused commands: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `python3 .../fetch_comments.py TommyKammy/codex-supervisor 1523`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
