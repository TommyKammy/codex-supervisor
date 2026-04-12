# Issue #1457: Make loop and readiness output distinguish blocked partial-work incidents from an empty backlog

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1457
- Branch: codex/issue-1457
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3543601c2d50626981344525537a130d94ce8448
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-12T07:46:14.238Z

## Latest Codex Summary
- Reused the persisted `preserved_partial_work=yes` failure-context signal to surface blocked manual-review partial-work incidents in readiness/selection output and the no-runnable run-once message.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The queue looked empty because readiness and run-once fallback messaging collapsed `manual_review + preserved_partial_work` into generic `no_runnable_issue` / `No matching open issue found`.
- What changed: Added a shared helper that finds the latest blocked manual-review record with preserved partial work from `last_failure_context.details`; readiness now appends `blocked_partial_work ...`, `status --why` emits `selection_reason=blocked_partial_work_manual_review issue=#...`, and run-once no-runnable messaging now names the blocked issue instead of pretending the backlog is empty.
- Current blocker: None in the issue-specific paths. Repo baseline still has unrelated failing tests outside this issue scope.
- Next exact step: Commit the checkpoint on `codex/issue-1457`; open/update a draft PR if requested by the supervisor flow.
- Verification gap: The exact `npm test -- <file>` commands still invoke unrelated repo-wide failures in this branch; issue-specific verification passed via direct `npx tsx --test ...` runs, and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/supervisor/supervisor-preserved-partial-work.ts`; `src/supervisor/supervisor-selection-readiness-summary.ts`; `src/supervisor/supervisor-selection-readiness-summary.test.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `src/run-once-issue-selection.ts`; `src/run-once-issue-selection.test.ts`.
- Rollback concern: Low. The new blocked-partial-work signal is only surfaced when the latest preserved partial-work incident is also a candidate issue blocked by `local_state:blocked`, so empty backlog and unrelated blocked states keep the prior `no_runnable_issue` behavior.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
