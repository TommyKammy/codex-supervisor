# Issue #1512: Synthetic parent-epic recovery records should not trigger doctor worktree warnings

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1512
- Branch: codex/issue-1512
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 50c6d38ca2f446b94a33710434b2ea1cc20bb2ee
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856u-nB
- Repeated failure signature count: 1
- Updated at: 2026-04-14T07:13:45.135Z

## Latest Codex Summary
Implemented the fix in [src/doctor.ts](src/doctor.ts): `doctor` now skips recovery-only synthetic done records that have no branch/workspace but do carry durable recovery metadata. That keeps the parent-epic auto-closure record visible on read-only surfaces without degrading real tracked-worktree diagnostics. I added the focused regression in [src/doctor.test.ts](src/doctor.test.ts) and tightened [src/supervisor/supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts) to use the synthetic parent-epic record shape directly.

I updated the issue journal, committed the change as `50c6d38`, pushed `codex/issue-1512`, and opened draft PR [#1513](https://github.com/TommyKammy/codex-supervisor/pull/1513). Local verification passed for the requested suites plus the focused reproducer. There are still untracked supervisor runtime artifacts under `.codex-supervisor/` from this workspace, but they were not included in the commit.

Summary: Fixed false `doctor` worktree warnings for synthetic parent-epic recovery records, added regression coverage, pushed branch, and opened draft PR #1513.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/doctor.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Next action: wait for CI and review on PR #1513, then address any follow-up if checks surface regressions
Failure signature: PRRT_kwDORgvdZ856u-nB

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1513#discussion_r3077714918
- Details:
  - src/doctor.ts:443 summary=_⚠️ Potential issue_ | _🟠 Major_ **Guard non-string state fields before calling `.trim()`.** `record.branch.trim()` and `record.workspace.trim()` can throw on malformed persist... url=https://github.com/TommyKammy/codex-supervisor/pull/1513#discussion_r3077714918

## Codex Working Notes
### Current Handoff
- Hypothesis: the review finding was valid, but the real failure surface was broader than `record.branch.trim()` and `record.workspace.trim()`; malformed persisted workspace fields also reached orphan-prune inspection and could flip the whole `worktrees` doctor check to `fail`.
- What changed: hardened `isRecoveryOnlySyntheticRecord` against non-string branch/workspace values, taught `diagnoseWorktrees` to treat non-string or blank workspace fields as per-record missing-workspace warnings, filtered orphan-prune inspection to records with inspectable workspace strings, and added a focused malformed-record regression in `src/doctor.test.ts`.
- Current blocker: none
- Next exact step: commit and push the review-fix patch on `codex/issue-1512`, then leave PR #1513 ready for the remaining GitHub review-thread follow-up.
- Verification gap: none for the requested local verification set.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/doctor.ts`, `src/doctor.test.ts`
- Rollback concern: low; the new guards only affect malformed persisted state and the intentionally synthetic recovery-only parent-epic record shape.
- Last focused command: `npm run build`
### Scratchpad
- Review thread `PRRT_kwDORgvdZ856u-nB` reproduced locally via a malformed synthetic done record with `branch: null` and `workspace: null`.
- Commands run this turn: `npx tsx --test src/doctor.test.ts` (failed once while tracing the broader crash path, then passed after the full fix); `npm run build` (passed after each code iteration).
- Remaining operator-facing step after push: decide whether to reply to or resolve the CodeRabbit thread on PR #1513.
