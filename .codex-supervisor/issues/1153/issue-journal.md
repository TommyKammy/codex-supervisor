# Issue #1153: Separate GitHub-derived PR lifecycle state from host-local loop execution errors

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1153
- Branch: codex/issue-1153
- Workspace: .
- Journal: .codex-supervisor/issues/1153/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 114b482ed45d061a8d29b53de11b10defbb8d2d2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T05:49:19.445Z

## Latest Codex Summary
Separated tracked-PR lifecycle state from host-local recovery failures in the persisted record. The main change is in [supervisor-failure-helpers.ts](src/supervisor/supervisor-failure-helpers.ts): when a tracked PR already has persisted lifecycle truth, `recoverUnexpectedCodexTurnFailure` now preserves that `state`/`blocked_reason`/`last_failure_context` and records the host-local error separately in new runtime-diagnostic fields added on [types.ts](src/core/types.ts). I also surfaced those runtime diagnostics in status output via [supervisor-detailed-status-assembly.ts](src/supervisor/supervisor-detailed-status-assembly.ts).

I added a focused regression test in [supervisor-recovery-failure-flows.test.ts](src/supervisor/supervisor-recovery-failure-flows.test.ts) for the chronology-error seam after tracked-PR recovery, plus a status-model assertion in [supervisor-status-model.test.ts](src/supervisor/supervisor-status-model.test.ts). I updated the issue journal working notes as requested.

Verification: the focused named tests passed. A broader full-file run of `src/supervisor/supervisor-recovery-failure-flows.test.ts` hit an unexpected stale-lock requeue path in an existing-style test, so I’m not claiming full-suite completion yet.

Summary: Preserved GitHub-derived tracked PR lifecycle state during host-local recovery failures and stored runtime diagnostics separately, with focused regression/status coverage added.
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-status-model.test.ts`; `npx tsx --test --test-name-pattern "preserves tracked PR lifecycle state while recording host-local runtime diagnostics|preserves active-line ordering across PR and failure sections|preserves dirty recovery context and timeout bookkeeping" src/supervisor/supervisor-recovery-failure-flows.test.ts src/supervisor/supervisor-status-model.test.ts`; attempted full `npx tsx --test src/supervisor/supervisor-recovery-failure-flows.test.ts` but one broader test diverged into stale-lock requeue
Next action: Run the adjacent tracked-PR reconciliation/status suites and resolve or explain the broader recovery-flow test divergence before committing this checkpoint
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: A host-local runtime failure after fresh tracked-PR lifecycle facts are already persisted should not rewrite the record back to `failed`; it should preserve the GitHub-derived state/blocker and record the runtime error separately for operators.
- What changed: Added optional `last_runtime_error`, `last_runtime_failure_kind`, and `last_runtime_failure_context` fields on `IssueRunRecord`; updated `recoverUnexpectedCodexTurnFailure` to preserve tracked-PR lifecycle fields while recording host-local failure diagnostics separately; surfaced runtime diagnostics in detailed status; added focused regression tests for both dirty-worktree bookkeeping and tracked-PR lifecycle preservation.
- Current blocker: No product blocker. The existing broad `runOnce recovers when post-codex refresh throws after leaving a dirty worktree` integration test still diverges in a full-file run, and I intentionally left that broader harness behavior unchanged while stabilizing this issue-specific checkpoint.
- Next exact step: Commit this checkpoint, then open or update a draft PR for branch `codex/issue-1153` with the focused runtime-diagnostic separation change set and the current verification note.
- Verification gap: Full `src/supervisor/supervisor-recovery-failure-flows.test.ts` remains broader than this change and still diverges in its existing `runOnce recovers when post-codex refresh throws after leaving a dirty worktree` path. Focused named recovery tests and adjacent tracked-PR reconciliation/status suites passed.
- Files touched: src/core/types.ts; src/supervisor/supervisor-failure-helpers.ts; src/supervisor/supervisor-detailed-status-assembly.ts; src/supervisor/supervisor-test-helpers.ts; src/supervisor/supervisor-recovery-failure-flows.test.ts; src/supervisor/supervisor-status-model.test.ts
- Rollback concern: Low to moderate. The main behavioral change is that tracked-PR unexpected host failures no longer force `state=failed`; downstream flows that implicitly equate missing runtime diagnostics with no host failure should be reviewed.
- Last focused command: npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-status-model.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-28T05:54:22Z: Verified `npx tsx --test --test-name-pattern "preserves tracked PR lifecycle state while recording host-local runtime diagnostics|preserves dirty recovery context and timeout bookkeeping" src/supervisor/supervisor-recovery-failure-flows.test.ts` and `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-status-model.test.ts`; both passed. I briefly explored broad-test harness fixes, then reverted those unrelated edits and kept the original broader divergence unchanged.
