# Issue #1528: Perf: bound tracked_merged_but_open_issues reconciliation on large hosts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1528
- Branch: codex/issue-1528
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 1fee534698200459364f83a7ced37678f99e1858
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856z87d
- Repeated failure signature count: 1
- Updated at: 2026-04-14T12:36:09.008Z

## Latest Codex Summary
Added bounded observability for `tracked_merged_but_open_issues`. The reconciliation path now emits an explicit recovery event when it stops at the per-cycle budget with backlog remaining, and read-only `status`/`doctor` now show the persisted resume cursor plus tracked backlog counts so operators can tell the loop is draining work rather than stuck. I also added a shared backlog-diagnostics helper and updated the focused reconciliation/diagnostics tests accordingly.

Checkpoint commit: `1fee534` (`Bound tracked PR reconciliation backlog diagnostics`)

Summary: Added bounded tracked-PR backlog diagnostics to recovery/status/doctor and committed the change as `1fee534`
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/recovery-tracked-pr-reconciliation.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Next action: Open or update the PR with commit `1fee534`, then proceed with normal review/CI checks
Failure signature: PRRT_kwDORgvdZ856z87d

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1529#discussion_r3079464712
- Details:
  - src/doctor.ts:631 summary=_⚠️ Potential issue_ | _🟠 Major_ **Guard backlog-state loading so doctor doesn’t fail hard on state-read errors.** Line 625 introduces an unguarded `loadState()` call. url=https://github.com/TommyKammy/codex-supervisor/pull/1529#discussion_r3079464712

## Codex Working Notes
### Current Handoff
- Hypothesis: the bounded backlog diagnostics were correct, but `doctor` still had one unguarded follow-up `loadState()` call after the main checks that could abort the whole command on filesystem read errors.
- What changed: Guarded the backlog-only `loadState()` call in `diagnoseSupervisorHost`, degrade that failure into the canonical `state_file` doctor check with an explicit detail line, suppress the backlog diagnostic line when the follow-up read fails, and added a regression test for the second-read-throws path.
- Current blocker: none
- Next exact step: let PR #1529 resync on commit `e227a8d`, then resolve or reply to the remaining automated review thread if the refreshed diff still needs operator action.
- Verification gap: none for this review-fix scope; I reran focused doctor/status diagnostics coverage plus a clean build and did not rerun unrelated reconciliation suites this turn.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/doctor.ts`, `src/doctor.test.ts`
- Rollback concern: low; the change only affects `doctor` resilience when the diagnostic-only backlog reload fails, and the new failure mode is an explicit `state_file` diagnostic instead of a thrown command.
- Last focused command: `npm run build`
### Scratchpad
- Review fix committed and pushed as `e227a8d` (`Keep doctor resilient on backlog state reload failures`).
- Keep this section short. The supervisor may compact older notes automatically.
