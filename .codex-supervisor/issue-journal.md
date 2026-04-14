# Issue #1512: Synthetic parent-epic recovery records should not trigger doctor worktree warnings

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1512
- Branch: codex/issue-1512
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b18a909e920417b5b62eceb1365893eea23501d2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T07:02:01.829Z

## Latest Codex Summary
- Scoped `doctor` to ignore recovery-only synthetic done records created for untracked parent-epic auto-closures, while leaving tracked worktree validation unchanged.
- Added a focused `doctor` regression test for the synthetic parent-epic record shape and tightened read-only status coverage to use the same empty branch/workspace record form.

## Active Failure Context
- Primary failure reproduced before the fix: `doctor` warned on synthetic parent-epic recovery records because they persist `workspace: ""` and were treated like tracked worktrees.

## Codex Working Notes
### Current Handoff
- Hypothesis: `diagnoseWorktrees` was validating every persisted issue record as a tracked workspace, including synthetic recovery-only parent-epic records that intentionally persist empty branch/workspace fields.
- What changed: Added `isRecoveryOnlySyntheticRecord` in `src/doctor.ts` and skipped those records during worktree diagnostics; added/updated focused tests in `src/doctor.test.ts` and `src/supervisor/supervisor-diagnostics-status-selection.test.ts`.
- Current blocker: none
- Next exact step: commit the focused fix on `codex/issue-1512` and leave the branch ready for PR/open-review flow.
- Verification gap: none for the requested local verification set.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/doctor.ts`, `src/doctor.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: low; the exemption is intentionally narrow and only matches synthetic done records with empty branch/workspace plus durable recovery metadata.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
