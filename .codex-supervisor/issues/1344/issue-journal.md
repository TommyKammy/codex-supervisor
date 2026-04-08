# Issue #1344: Enhancement: opt-in same-PR auto-repair for current-head manual_review_blocked local-review residuals

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1344
- Branch: codex/issue-1344
- Workspace: .
- Journal: .codex-supervisor/issues/1344/issue-journal.md
- Current phase: local_review_fix
- Attempt count: 9 (implementation=2, repair=3)
- Last head SHA: 9a667d1d5ea808783f57c4f40f5c08751f1340a9
- Blocked reason: none
- Last failure signature: local-review:high:high:6:3:clean
- Repeated failure signature count: 2
- Updated at: 2026-04-08T04:32:36.369Z

## Latest Codex Summary
Tightened the same-PR `manual_review_blocked` repair gate so human review decisions cannot reopen the auto-repair lane. I added `reviewDecisionAllowsSamePrManualReviewRepair()` in `src/review-handling.ts`, reused it from `src/supervisor/supervisor-pre-merge-evaluation.ts`, and now keep `CHANGES_REQUESTED` blocked unless the top-level review is explicitly the configured bot's `nitpick_only` signal. Focused regressions now cover the helper path, the post-turn transition, and the pre-merge status DTO.

Local verification passed with `npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts` and `npm run build`.

Summary: Tightened same-PR manual-review repair gating to keep human `CHANGES_REQUESTED` blocked and added focused regressions
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts`; `npm run build`
Next action: Commit and push this repair, then recheck PR #1345 for any remaining local-review findings
Failure signature: local-review:high:high:6:3:clean

## Active Failure Context
- Category: blocked
- Summary: Local review found 6 actionable finding(s) across 6 root cause(s); max severity=high; verified high-severity findings=3; verified max severity=high.
- Details:
  - findings=6
  - root_causes=6
  - summary=<redacted-local-path>

## Codex Working Notes
### Current Handoff
- Hypothesis: The same-PR `manual_review_blocked` repair lane is only safe when local review is the only remaining blocker on the current head; human `CHANGES_REQUESTED` and `REVIEW_REQUIRED` decisions must keep the PR in manual review unless the top-level signal is explicitly a configured-bot `nitpick_only` review.
- What changed: Added `reviewDecisionAllowsSamePrManualReviewRepair()` in `src/review-handling.ts` and switched both `localReviewManualReviewNeedsRepair()` and `repairDisposition()` in `src/supervisor/supervisor-pre-merge-evaluation.ts` to use it. Added focused regressions in `src/review-handling.test.ts`, `src/post-turn-pull-request.test.ts`, and `src/supervisor/supervisor-pre-merge-evaluation.test.ts` for the human `CHANGES_REQUESTED` case.
- Current blocker: none
- Next exact step: Commit and push this guardrail fix, then recheck PR #1345 on the new head for any remaining local-review findings, review-thread follow-up, or CI drift.
- Verification gap: None for this repair checkpoint after `npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts` and `npm run build`.
- Files touched: src/review-handling.ts; src/supervisor/supervisor-pre-merge-evaluation.ts; src/review-handling.test.ts; src/post-turn-pull-request.test.ts; src/supervisor/supervisor-pre-merge-evaluation.test.ts
- Rollback concern: Low. The change only narrows the same-PR manual-review repair lane to avoid overriding real human review decisions.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
