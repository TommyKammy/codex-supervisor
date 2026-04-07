# Issue #1344: Enhancement: opt-in same-PR auto-repair for current-head manual_review_blocked local-review residuals

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1344
- Branch: codex/issue-1344
- Workspace: .
- Journal: .codex-supervisor/issues/1344/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4c9c11e5c919afc8463f343254502c69041b2b4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T22:10:27.965Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The same-PR local-review repair gate only recognized `follow_up_eligible`, so current-head local-review `manual_review_blocked` residuals were forced into manual review even when the operator opted into same-PR repair.
- What changed: Expanded the opt-in same-PR repair predicates to include current-head `manual_review_blocked` local-review residuals, kept CI/review/conflict precedence intact, updated post-turn/operator-facing repair messaging, and added focused regression coverage for policy, post-turn routing, repair context prompts, and pre-merge status rendering.
- Current blocker: none
- Next exact step: Commit the focused same-PR manual-review residual repair changes on `codex/issue-1344` and leave the branch ready for PR/update.
- Verification gap: None on the targeted regression path; requested tests and `npm run build` passed locally.
- Files touched: src/review-handling.ts; src/post-turn-pull-request.ts; src/turn-execution-orchestration.ts; src/codex/codex-prompt.ts; src/supervisor/supervisor-pre-merge-evaluation.ts; src/review-handling.test.ts; src/pull-request-state-policy.test.ts; src/post-turn-pull-request.test.ts; src/supervisor/supervisor-pre-merge-evaluation.test.ts; src/codex/codex-prompt.test.ts
- Rollback concern: Low to moderate; the change broadens an existing opt-in lane only when `localReviewFollowUpRepairEnabled` is true, but reverting should preserve the new regression tests or revert them together with the predicate changes.
- Last focused command: npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts && npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
