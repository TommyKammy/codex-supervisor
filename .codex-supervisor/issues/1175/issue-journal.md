# Issue #1175: Broaden bounded fail-soft continuation for transient full-inventory failures

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1175
- Branch: codex/issue-1175
- Workspace: .
- Journal: .codex-supervisor/issues/1175/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 1a934dbb346db67c819d649404be80549b3cb02f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853dqXs|PRRT_kwDORgvdZ853dqXx
- Repeated failure signature count: 1
- Updated at: 2026-03-28T15:16:14.429Z

## Latest Codex Summary
Merged `github/main` into `codex/issue-1175`, resolved the overlapping inventory-refresh changes by keeping both `bounded_continuation_allowed` and `selection_permitted: "snapshot_backed"`, reran the focused merged-file checks plus `tsc`, updated the issue journal, and pushed commits `a2b3cb2` and `1a934db` to `github/codex/issue-1175`. PR #1179 remains draft, and GitHub now reports it as `mergeable: true`. Local tracked files are clean; only untracked supervisor scratch remains under `.codex-supervisor/`.

Summary: Pushed the conflict-resolution merge for issue #1175, updated the journal, and cleared PR #1179 back to a mergeable draft state
State hint: draft_pr
Blocked reason: none
Tests: `npm exec --yes -- tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/core/state-store.test.ts src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Next action: Monitor draft PR #1179 CI/review state and address any follow-up on `codex/issue-1175`
Failure signature: PRRT_kwDORgvdZ853dqXs|PRRT_kwDORgvdZ853dqXx

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1179#discussion_r3004938566
- Details:
  - src/run-once-cycle-prelude.ts:217 summary=_⚠️ Potential issue_ | _🟠 Major_ **Keep degraded blocked recovery scoped to tracked PR states.** This catch path still calls `reconcileRecoverableBlockedIssueStates(state, [])`... url=https://github.com/TommyKammy/codex-supervisor/pull/1179#discussion_r3004938566
  - src/run-once-issue-selection.ts:460 summary=_⚠️ Potential issue_ | _🟠 Major_ **Don't demote tracked PR records to `queued` here.** This branch runs for any active record. url=https://github.com/TommyKammy/codex-supervisor/pull/1179#discussion_r3004938572

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining CodeRabbit findings are valid regressions from broadening degraded continuation: the malformed-refresh recovery branch must stay scoped to tracked PR blocked states, and repeated transient refresh failures must not collapse tracked PR lifecycle states back to `queued`.
- What changed: Scoped the degraded `reconcileRecoverableBlockedIssueStates` call in `src/run-once-cycle-prelude.ts` with `{ onlyTrackedPrStates: true }`, restricted the repeated-failure active-issue requeue path in `src/run-once-issue-selection.ts` to pre-PR records (`pr_number === null`), added focused regressions in `src/run-once-cycle-prelude.test.ts` and `src/run-once-issue-selection.test.ts`, and pushed review-fix commit `f437184` to `github/codex/issue-1175`.
- Current blocker: none
- Next exact step: Monitor PR #1179 CI and remaining review state after pushed commit `f437184`, then address any follow-up if new failures appear.
- Verification gap: none for the focused review-fix checks; broader full-suite coverage remains unrun.
- Files touched: .codex-supervisor/issues/1175/issue-journal.md; src/backend/webui-dashboard-browser-logic.test.ts; src/backend/webui-dashboard-browser-logic.ts; src/core/state-store.test.ts; src/core/state-store.ts; src/core/types.ts; src/inventory-refresh-state.ts; src/run-once-cycle-prelude.test.ts; src/run-once-cycle-prelude.ts; src/run-once-issue-selection.test.ts; src/run-once-issue-selection.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-status-report.ts
- Rollback concern: Low to moderate; the main risk in this review-fix patch is accidentally broadening degraded continuation again by removing the tracked-PR-only recovery scope or by reintroducing tracked PR demotion to `queued` on repeated refresh failures.
- Last focused command: npm exec --yes -- tsx --test src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-29: Pushed review-fix commit `f437184` to `github/codex/issue-1175` after addressing the two remaining CodeRabbit findings.
- 2026-03-29: Addressed the two remaining CodeRabbit findings locally, then verified with `npm exec --yes -- tsx --test src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts` and `./node_modules/.bin/tsc -p tsconfig.json --noEmit`.
- 2026-03-28: Pushed merge commit `a2b3cb2` to `github/codex/issue-1175` to update draft PR #1179 after the conflict-resolution pass.
- 2026-03-28: Merged `github/main` (`9b69d22`) into `codex/issue-1175`, resolved the overlapping inventory-refresh conflicts, and kept both `bounded_continuation_allowed` and `selection_permitted: "snapshot_backed"` persistence in the merged branch.
- 2026-03-28: Re-ran focused merged-file verification with `npm exec --yes -- tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/core/state-store.test.ts src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and all 116 tests passed.
- 2026-03-28: Verified `./node_modules/.bin/tsc -p tsconfig.json --noEmit` passes after the merge-resolution changes.
- 2026-03-28: Re-ran focused regression coverage with `npm exec --yes -- tsx --test src/core/state-store.test.ts src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and all 100 tests passed.
- 2026-03-28: Installed locked dev dependencies with `npm ci`, then verified `./node_modules/.bin/tsc -p tsconfig.json --noEmit` passes cleanly in-worktree.
- 2026-03-28: Pushed `codex/issue-1175` to `github` and opened draft PR #1179: https://github.com/TommyKammy/codex-supervisor/pull/1179
