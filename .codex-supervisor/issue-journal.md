# Issue #1524: Bug: tracked PR stale_review_bot blockers should auto-clear when GitHub threads are already resolved

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1524
- Branch: codex/issue-1524
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 5 (implementation=3, repair=2)
- Last head SHA: b7f0e82e38f260e4de5e83506ae19d19e2f6d19d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T11:15:24Z

## Latest Codex Summary
Merged `origin/main` into `codex/issue-1524` as commit `b7f0e82` to pick up PR `#1523`'s merged-closure provenance backfill in [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts), [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts), and [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts). The only textual conflict was the issue journal, which I resolved in favor of the `#1524` record.

The stale tracked-PR `stale_review_bot` auto-clear behavior remains intact on top of the new base. Focused verification passed with `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts` and `npm run build`. Draft PR `#1525` is ready for a push to refresh GitHub mergeability.

Summary: Integrated `origin/main`, resolved the journal-only conflict, and reverified the stale tracked-PR blocker fix plus the merged recovery-path changes.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`
Next action: Push `codex/issue-1524` so PR #1525 can recompute mergeability on the integrated head, then address any new review or CI signals.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only real merge conflict was the per-issue journal; `#1523`'s merged-closure provenance backfill composes cleanly with `#1524`'s stale tracked-PR blocker convergence logic.
- What changed: stashed supervisor artifacts, merged `origin/main`, kept the `#1524` journal content, accepted upstream edits in `src/recovery-reconciliation.ts`, `src/run-once-cycle-prelude.test.ts`, and `src/supervisor/supervisor-recovery-reconciliation.test.ts`, then reran the combined focused verification set.
- Current blocker: none.
- Next exact step: push the integrated branch to update draft PR #1525, then confirm GitHub clears the old DIRTY merge state on the new head.
- Verification gap: none for the issue-scoped and merge-scoped checks; GitHub-side mergeability still needs its normal post-push refresh.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/run-once-cycle-prelude.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Rollback concern: low; this turn only integrates already-merged base-branch recovery changes on top of the existing stale tracked-PR blocker fix.
- Last focused commands: `git stash push --include-untracked -m 'issue-1524-pre-merge' -- .codex-supervisor/issue-journal.md .codex-supervisor/pre-merge .codex-supervisor/replay .codex-supervisor/turn-in-progress.json`; `git fetch origin`; `git merge origin/main`; `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`; `git commit -m "Merge origin/main into codex/issue-1524"`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
