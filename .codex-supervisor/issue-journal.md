# Issue #1512: Synthetic parent-epic recovery records should not trigger doctor worktree warnings

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1512
- Branch: codex/issue-1512
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 1db8b99444460e4f1c80890887f1b9cf52f51007
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856vF7K
- Repeated failure signature count: 1
- Updated at: 2026-04-14T07:21:33.301Z

## Latest Codex Summary
Tightened `doctor` synthetic-record detection so recovery-only parent-epic records now require real recovery metadata instead of accepting `undefined` values as present. In [src/doctor.ts](src/doctor.ts), `isRecoveryOnlySyntheticRecord` now requires non-empty string `last_recovery_reason` and `last_recovery_at` values before skipping worktree diagnostics. I also added a focused regression in [src/doctor.test.ts](src/doctor.test.ts) covering a synthetic-like done record with empty branch/workspace fields but missing recovery metadata, which now correctly degrades to a warning instead of being skipped.

The issue journal is updated with the review-fix verification run. I have not posted a GitHub reply or resolved the remaining CodeRabbit thread.

Summary: Tightened recovery-only synthetic detection to reject missing recovery metadata, added a regression test, and re-ran the issue verification set
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/doctor.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
Next action: push the review-fix commit for PR #1513, then decide whether to reply to or resolve the remaining CodeRabbit review thread
Failure signature: PRRT_kwDORgvdZ856vF7K

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1513#discussion_r3077756591
- Details:
  - src/doctor.ts:447 summary=_⚠️ Potential issue_ | _🟠 Major_ **Tighten synthetic-record detection to avoid false diagnostic skips.** The predicate treats `undefined` as “present” because it checks `!== nu... url=https://github.com/TommyKammy/codex-supervisor/pull/1513#discussion_r3077756591

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining CodeRabbit finding was valid because `record.last_recovery_reason !== null` and `record.last_recovery_at !== null` still treated `undefined` as present, which could misclassify malformed legacy records as recovery-only synthetic and suppress real workspace warnings.
- What changed: tightened `isRecoveryOnlySyntheticRecord` to require non-empty string recovery metadata, while preserving the earlier non-string `branch`/`workspace` guards and missing-workspace degradation path; added a focused regression in `src/doctor.test.ts` for a synthetic-like done record with empty branch/workspace fields but missing recovery metadata.
- Current blocker: none
- Next exact step: commit and push the review-fix patch on `codex/issue-1512`, then decide whether to reply to or resolve the remaining CodeRabbit thread on PR #1513.
- Verification gap: none for the requested local verification set.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/doctor.ts`, `src/doctor.test.ts`
- Rollback concern: low; the new guards only affect malformed persisted state and the intentionally synthetic recovery-only parent-epic record shape.
- Last focused command: `npm run build`
### Scratchpad
- Review thread `PRRT_kwDORgvdZ856vF7K` reproduced locally from the live `!== null` checks in `isRecoveryOnlySyntheticRecord`; the branch still needed a follow-up patch beyond commit `1db8b99`.
- Commands run this turn: `gh auth status && gh pr view 1513 --json number,url,reviewDecision,state,mergeStateStatus,comments,reviews`; `npx tsx --test src/doctor.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`.
- Remaining operator-facing step after push: decide whether to reply to or resolve the CodeRabbit thread on PR #1513.
