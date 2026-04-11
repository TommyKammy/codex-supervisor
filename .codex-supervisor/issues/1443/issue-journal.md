# Issue #1443: Improve tracked-PR self-healing after supervisor downtime

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1443
- Branch: codex/issue-1443
- Workspace: .
- Journal: .codex-supervisor/issues/1443/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 5ee59df82f9dde15fff78b717c8710d909619920
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856VEIF
- Repeated failure signature count: 1
- Updated at: 2026-04-11T22:35:00.369Z

## Latest Codex Summary
Implemented the tracked-PR downtime catch-up in the bounded merged/open reconciliation path so open tracked PR records now refresh from authoritative GitHub facts when their projected lifecycle state changed while the supervisor was down. That covers stale active states like `waiting_ci`, `addressing_review`, and transitions into blocked tracked-PR states without waiting for a later babysat loop. I also updated mismatch diagnostics to point operators at a concrete one-shot refresh path: `run-once --dry-run`.

Regression coverage was added for the new `runOnce` behavior and for persisted reconciliation cursor behavior across cycles. I updated the issue journal handoff, committed the checkpoint as `5ee59df` (`Improve tracked PR downtime reconciliation`), pushed `codex/issue-1443`, and opened draft PR #1445: https://github.com/TommyKammy/codex-supervisor/pull/1445

Summary: Added bounded tracked-PR lifecycle refresh for stale open PR states after downtime, updated operator recovery guidance, verified the required suites, committed, pushed, and opened draft PR #1445.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`; `npx tsx --test --test-name-pattern "runOnce reconciles tracked PR state before reserving a new runnable issue|runOnce refreshes stale waiting_ci tracked PR review state after downtime before stopping on the new blocked state|runOnce keeps tracked PR repair work retryable when the same failure repeats after PR head progress" src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Wait for PR #1445 review/CI and address any follow-up if the tracked-PR recovery path needs adjustment.
Failure signature: PRRT_kwDORgvdZ856VEIF

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1445#discussion_r3068679266
- Details:
  - src/recovery-tracked-pr-reconciliation.ts:286 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Keep the open-PR refresh branch aligned with the stale-failed reconciliation path.** Unlike `reconcileStaleFailedTrackedPrRecord` below, this... url=https://github.com/TommyKammy/codex-supervisor/pull/1445#discussion_r3068679266

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review gap was narrower than the original downtime bug: open tracked-PR resume reconciliation cleared reconciliation-progress `waitStep` at loop start but did not repopulate it when fresh GitHub facts projected the record into `waiting_ci`.
- What changed: Mirrored the stale-failed tracked-PR path in merged/open resume reconciliation by threading `inferGitHubWaitStep` into `reconcileTrackedMergedButOpenIssuesInModule`, updating reconciliation progress with the inferred GitHub wait step before applying the recovery patch, adding a regression that proves an open `pr_open` record refreshed into `waiting_ci` reports `configured_bot_initial_grace_wait`, and pushing the review fix as commit `10f115e` on `codex/issue-1443`.
- Current blocker: none
- Next exact step: Wait for PR #1445 re-review or resolve the thread manually if the operator wants an explicit reply/resolution action.
- Verification gap: The full `src/supervisor/supervisor-execution-orchestration.test.ts` suite still contains a pre-existing unrelated stale no-PR test failure outside this tracked-PR issue scope; the targeted tracked-PR regressions and the issue's required verification commands passed.
- Files touched: src/recovery-tracked-pr-reconciliation.ts; src/recovery-reconciliation.ts; src/supervisor/tracked-pr-mismatch.ts; src/supervisor/supervisor-execution-orchestration.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts
- Rollback concern: The added wait-step projection is intentionally limited to the open tracked-PR resume path and only updates reconciliation progress, so it should not perturb persisted issue state or same-state retry accounting.
- Last focused command: git push origin codex/issue-1443
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
