# Issue #1344: Enhancement: opt-in same-PR auto-repair for current-head manual_review_blocked local-review residuals

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1344
- Branch: codex/issue-1344
- Workspace: .
- Journal: .codex-supervisor/issues/1344/issue-journal.md
- Current phase: local_review_fix
- Attempt count: 13 (implementation=2, repair=4)
- Last head SHA: aec7552637462a4e614654d0211e571ec54abe90
- Blocked reason: none
- Last failure signature: local-review:medium:none:1:0:clean
- Repeated failure signature count: 2
- Updated at: 2026-04-08T06:10:38.191Z

## Latest Codex Summary
The repair is in on `codex/issue-1344` and pushed as `aec7552` to PR #1345. I unified the same-PR manual-review repair summary/failure-context logic in `review-handling`, then reused it in the steady-state supervisor refresh and the ready-to-merge refresh so `last_error`, `last_failure_context`, and failure-signature tracking no longer fall back to stale manual-review-blocked text after a restart or later cycle. I also fixed the pre-merge DTO so current-head `manual_review_blocked` still reports `manual_review_required` when the manual-repair opt-in is off.

Verification passed with `npx tsx --test src/review-handling.test.ts src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts` and `npm run build`. I updated the issue journal working notes and left the transient untracked `.codex-supervisor/` artifacts alone.

Summary: Preserve same-PR manual-review repair context across supervisor refresh paths and keep default-disabled pre-merge DTOs fail-closed
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/review-handling.test.ts src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`; `npm run build`
Next action: Recheck PR #1345 on head `aec7552` for any remaining local-review findings, review-thread follow-up, or CI drift
Failure signature: local-review:medium:none:1:0:clean

## Active Failure Context
- Category: blocked
- Summary: Local review found 1 actionable finding(s) across 1 root cause(s); max severity=medium; verified high-severity findings=0; verified max severity=none.
- Details:
  - findings=1
  - root_causes=1
  - summary=<redacted-local-path>

## Codex Working Notes
### Current Handoff
- Hypothesis: the last remaining drift was limited to the pre-merge DTO path. `loadPreMergeEvaluationDto()` could still expose `repair: "same_pr_manual_review_current_head"` after an operator switched local review to advisory, because it checked the opt-in flag and PR review state but never revalidated that local review was still gating.
- What changed: Threaded the existing `localReviewIsGating()` result into `repairDisposition()` in `src/supervisor/supervisor-pre-merge-evaluation.ts` and now require that gating signal before reporting `same_pr_manual_review_current_head`. This keeps the DTO aligned with `localReviewManualReviewNeedsRepair()` and fails closed back to `manual_review_required` in advisory mode. Added a focused regression in `src/supervisor/supervisor-pre-merge-evaluation.test.ts` covering opted-in advisory mode with current-head `manual_review_blocked` residuals.
- Current blocker: none
- Next exact step: Commit and push this advisory-mode DTO repair checkpoint, then recheck PR #1345 on the new head for any remaining local-review findings, review-thread follow-up, or CI drift.
- Verification gap: None for this checkpoint after `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts` and `npm run build`.
- Files touched: src/supervisor/supervisor-pre-merge-evaluation.ts; src/supervisor/supervisor-pre-merge-evaluation.test.ts
- Rollback concern: Low. The patch only tightens DTO eligibility for the same-PR manual-review repair label, so the main rollback risk is reintroducing a contract mismatch between operator-facing status and the runtime repair state machine.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
