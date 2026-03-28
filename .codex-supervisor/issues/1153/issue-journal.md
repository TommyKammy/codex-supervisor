# Issue #1153: Separate GitHub-derived PR lifecycle state from host-local loop execution errors

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1153
- Branch: codex/issue-1153
- Workspace: .
- Journal: .codex-supervisor/issues/1153/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: fb85e646f66707ea42ddd75efd528e6b3220f84e
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853byTv
- Repeated failure signature count: 1
- Updated at: 2026-03-28T06:05:53.616Z

## Latest Codex Summary
Implemented the checkpoint on `codex/issue-1153` and pushed commit `fb85e646f66707ea42ddd75efd528e6b3220f84e`.

The change separates host-local recovery failures from persisted GitHub-derived PR lifecycle truth: tracked PR records now keep their existing `state`/`blocked_reason`/failure context, while new runtime-only diagnostics are stored separately and surfaced in detailed status. I added focused regression coverage for the tracked-PR chronology/runtime-error path and updated the issue journal. Draft PR is open at https://github.com/TommyKammy/codex-supervisor/pull/1159.

Verification passed for:
- `npx tsx --test --test-name-pattern "preserves tracked PR lifecycle state while recording host-local runtime diagnostics|preserves dirty recovery context and timeout bookkeeping" src/supervisor/supervisor-recovery-failure-flows.test.ts`
- `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-status-model.test.ts`

The broader existing full-file `src/supervisor/supervisor-recovery-failure-flows.test.ts` divergence remains unchanged and is called out in the journal and PR notes. Local-only untracked supervisor artifacts remain under `.codex-supervisor/`.

Summary: Committed and pushed the tracked-PR/runtime-error separation change, updated the issue journal, and opened draft PR #1159.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test --test-name-pattern "preserves tracked PR lifecycle state while recording host-local runtime diagnostics|preserves dirty recovery context and timeout bookkeeping" src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-status-model.test.ts`
Next action: Monitor draft PR #1159, then decide whether to stabilize the pre-existing broad recovery-flow divergence or leave it explicitly out of scope for this issue.
Failure signature: PRRT_kwDORgvdZ853byTv

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1159#discussion_r3004324959
- Details:
  - src/core/types.ts:296 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Normalize the new `last_runtime_*` fields during state hydration.** These fields are now part of the persisted record shape, but `src/core/st... url=https://github.com/TommyKammy/codex-supervisor/pull/1159#discussion_r3004324959

## Codex Working Notes
### Current Handoff
- Hypothesis: A host-local runtime failure after fresh tracked-PR lifecycle facts are already persisted should not rewrite the record back to `failed`; it should preserve the GitHub-derived state/blocker and record the runtime error separately for operators.
- What changed: Added optional `last_runtime_error`, `last_runtime_failure_kind`, and `last_runtime_failure_context` fields on `IssueRunRecord`; updated `recoverUnexpectedCodexTurnFailure` to preserve tracked-PR lifecycle fields while recording host-local failure diagnostics separately; surfaced runtime diagnostics in detailed status; added focused regression tests for both dirty-worktree bookkeeping and tracked-PR lifecycle preservation; then fixed the state hydration path so older JSON/sqlite records coalesce the new runtime-only fields to canonical `null` values during load.
- Current blocker: No product blocker. The existing broad `runOnce recovers when post-codex refresh throws after leaving a dirty worktree` integration test still diverges in a full-file run, and I intentionally left that broader harness behavior unchanged while stabilizing this issue-specific checkpoint.
- Next exact step: Commit and push the hydration-normalization follow-up on `codex/issue-1153`, then update PR #1159 so the unresolved review thread can be re-evaluated against the fresh head.
- Verification gap: Full `src/supervisor/supervisor-recovery-failure-flows.test.ts` remains broader than this change and still diverges in its existing `runOnce recovers when post-codex refresh throws after leaving a dirty worktree` path. Focused named recovery tests, adjacent tracked-PR reconciliation/status suites, and the dedicated `src/core/state-store.test.ts` hydration coverage passed.
- Files touched: src/core/types.ts; src/core/state-store.ts; src/core/state-store.test.ts; src/supervisor/supervisor-failure-helpers.ts; src/supervisor/supervisor-detailed-status-assembly.ts; src/supervisor/supervisor-test-helpers.ts; src/supervisor/supervisor-recovery-failure-flows.test.ts; src/supervisor/supervisor-status-model.test.ts
- Rollback concern: Low to moderate. The main behavioral change is that tracked-PR unexpected host failures no longer force `state=failed`; downstream flows that implicitly equate missing runtime diagnostics with no host failure should be reviewed.
- Last focused command: npx tsx --test src/core/state-store.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-28T06:07:38Z: Addressed review thread `PRRT_kwDORgvdZ853byTv` locally by adding `last_runtime_*` coalescing to `normalizeIssueRecord` and regression coverage for both legacy JSON and sqlite hydration. Verified `npx tsx --test src/core/state-store.test.ts`, `npx tsx --test --test-name-pattern "preserves tracked PR lifecycle state while recording host-local runtime diagnostics|preserves dirty recovery context and timeout bookkeeping" src/supervisor/supervisor-recovery-failure-flows.test.ts`, and `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-status-model.test.ts`; all passed.
- 2026-03-28T05:54:22Z: Verified `npx tsx --test --test-name-pattern "preserves tracked PR lifecycle state while recording host-local runtime diagnostics|preserves dirty recovery context and timeout bookkeeping" src/supervisor/supervisor-recovery-failure-flows.test.ts` and `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-status-model.test.ts`; both passed. I briefly explored broad-test harness fixes, then reverted those unrelated edits and kept the original broader divergence unchanged.
