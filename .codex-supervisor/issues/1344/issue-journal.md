# Issue #1344: Enhancement: opt-in same-PR auto-repair for current-head manual_review_blocked local-review residuals

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1344
- Branch: codex/issue-1344
- Workspace: .
- Journal: .codex-supervisor/issues/1344/issue-journal.md
- Current phase: local_review_fix
- Attempt count: 12 (implementation=2, repair=3)
- Last head SHA: 00a3d30b153883ae58910ee19c1f32fc2b724c9c
- Blocked reason: none
- Last failure signature: local-review:medium:none:3:0:clean
- Repeated failure signature count: 2
- Updated at: 2026-04-08T05:31:55.795Z

## Latest Codex Summary
Tightened the same-PR manual-review repair gate so it now fails closed on any aggregate GitHub `CHANGES_REQUESTED`, instead of treating a configured bot’s `nitpick_only` top-level review as sufficient proof that the block is bot-only. I added regressions in the review-handling, policy, and post-turn flows for that mixed-review case, and updated the operator docs and shipped example config to document `localReviewManualReviewRepairEnabled` separately from `localReviewFollowUpRepairEnabled`.

The repair is committed and pushed on `codex/issue-1344` as `00a3d30` (`Fail closed same-PR manual-review repair on changes requested`). I updated the issue journal working notes and left the transient untracked `.codex-supervisor/` artifacts alone.

Summary: Fail closed same-PR manual-review repair on aggregate `CHANGES_REQUESTED` and document the separate manual-review opt-in
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts`; `npm run build`
Next action: Recheck PR #1345 on head `00a3d30` for any remaining local-review findings, review-thread follow-up, or CI drift
Failure signature: local-review:medium:none:3:0:clean

## Active Failure Context
- Category: blocked
- Summary: Local review found 3 actionable finding(s) across 3 root cause(s); max severity=medium; verified high-severity findings=0; verified max severity=none.
- Details:
  - findings=3
  - root_causes=3
  - summary=<redacted-local-path>

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining manual-review same-PR repair drift came from duplicated lifecycle logic, where the post-turn transition knew how to describe `manual_review_blocked` same-PR repair but the steady-state supervisor refresh and ready-to-merge refresh still only synthesized failure context and `last_error` for high-severity retry.
- What changed: Added shared helpers in `src/review-handling.ts` for local-review repair continuation summaries and failure-context synthesis, then wired both `src/supervisor/supervisor.ts` refresh sites and `src/post-turn-pull-request.ts` to use the same logic. This keeps `last_failure_context`, `last_failure_signature`, and operator-facing `last_error` aligned for current-head manual-review same-PR repair after refreshes and restarts. Also fixed `src/supervisor/supervisor-pre-merge-evaluation.ts` so a current-head `manual_review_blocked` artifact still reports `manual_review_required` when `localReviewManualReviewRepairEnabled` is off, instead of falling through to `repair: "none"`. Added regressions in `src/review-handling.test.ts`, `src/supervisor/supervisor-pre-merge-evaluation.test.ts`, and `src/supervisor/supervisor-execution-cleanup.test.ts` for the shared helper behavior, the default-disabled DTO path, and both supervisor refresh paths.
- Current blocker: none
- Next exact step: Commit and push this repair checkpoint, then recheck PR #1345 on the new head for any remaining local-review findings, review-thread follow-up, or CI drift.
- Verification gap: None for this checkpoint after `npx tsx --test src/review-handling.test.ts src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/supervisor/supervisor-execution-cleanup.test.ts` and `npm run build`.
- Files touched: src/review-handling.ts; src/review-handling.test.ts; src/post-turn-pull-request.ts; src/supervisor/supervisor.ts; src/supervisor/supervisor-pre-merge-evaluation.ts; src/supervisor/supervisor-pre-merge-evaluation.test.ts; src/supervisor/supervisor-execution-cleanup.test.ts
- Rollback concern: Low. The change is narrow and mostly consolidates existing repair-lane behavior; the main risk is future divergence if a new local-review repair lane bypasses the shared summary/failure-context helpers.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
