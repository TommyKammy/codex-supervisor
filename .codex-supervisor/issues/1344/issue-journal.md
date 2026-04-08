# Issue #1344: Enhancement: opt-in same-PR auto-repair for current-head manual_review_blocked local-review residuals

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1344
- Branch: codex/issue-1344
- Workspace: .
- Journal: .codex-supervisor/issues/1344/issue-journal.md
- Current phase: local_review_fix
- Attempt count: 11 (implementation=2, repair=2)
- Last head SHA: e22e844054fbd0b135658e2543ae074986f0d176
- Blocked reason: none
- Last failure signature: local-review:high:high:2:1:clean
- Repeated failure signature count: 2
- Updated at: 2026-04-08T05:14:55.961Z

## Latest Codex Summary
Added a dedicated `localReviewManualReviewRepairEnabled` opt-in so same-PR repair for `manual_review_blocked` residuals is fail-closed by default, while leaving `localReviewFollowUpRepairEnabled` scoped to `follow_up_eligible` residuals. I also changed the post-ready retry accounting so same-head local-review repeat counts reset whenever the retry lane is inactive, which prevents stale counts from immediately tripping the repeat limit when the manual-review lane temporarily exits and later reopens.

The change is committed and pushed on `codex/issue-1344` as `e22e844` to update PR #1345. I updated the issue journal’s Codex Working Notes. The remaining untracked files in `.codex-supervisor/` are transient supervisor artifacts and were left out of the commit.

Summary: Added a fail-closed manual-review same-PR repair opt-in and reset stale same-head retry counters when the lane exits
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts src/config.test.ts`; `npm run build`
Next action: Recheck PR #1345 on head `e22e844` for any remaining local-review findings, review follow-up, or CI drift
Failure signature: local-review:high:high:2:1:clean

## Active Failure Context
- Category: blocked
- Summary: Local review found 2 actionable finding(s) across 2 root cause(s); max severity=high; verified high-severity findings=1; verified max severity=high.
- Details:
  - findings=2
  - root_causes=2
  - summary=<redacted-local-path>

## Codex Working Notes
### Current Handoff
- Hypothesis: same-PR repair for current-head `manual_review_blocked` residuals must fail closed on any aggregate GitHub `CHANGES_REQUESTED` because the current PR hydration only exposes the aggregate review decision plus the configured bot's own top-level strength, not actor attribution for the blocking review decision.
- What changed: Tightened `reviewDecisionAllowsSamePrManualReviewRepair` in `src/review-handling.ts` so manual-review same-PR repair now rejects both `REVIEW_REQUIRED` and aggregate `CHANGES_REQUESTED` instead of softening `CHANGES_REQUESTED` based on `configuredBotTopLevelReviewStrength`. Added regressions in `src/review-handling.test.ts`, `src/pull-request-state-policy.test.ts`, and `src/post-turn-pull-request.test.ts` covering the mixed-review case where the configured bot is `nitpick_only` but GitHub still reports aggregate `CHANGES_REQUESTED`. Updated `docs/configuration.md`, `docs/getting-started.md`, `docs/local-review.md`, `docs/examples/atlaspm.md`, and `docs/examples/atlaspm.supervisor.config.example.json` so the shipped operator docs and example config document `localReviewManualReviewRepairEnabled` separately from `localReviewFollowUpRepairEnabled`.
- Current blocker: none
- Next exact step: Commit and push this repair checkpoint, then recheck PR #1345 on the new head for any remaining local-review findings, review-thread follow-up, or CI drift.
- Verification gap: None for this checkpoint after `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts` and `npm run build`.
- Files touched: src/review-handling.ts; src/review-handling.test.ts; src/pull-request-state-policy.test.ts; src/post-turn-pull-request.test.ts; docs/configuration.md; docs/getting-started.md; docs/local-review.md; docs/examples/atlaspm.md; docs/examples/atlaspm.supervisor.config.example.json
- Rollback concern: Low. The code path is narrower than before because aggregate GitHub `CHANGES_REQUESTED` now always keeps manual-review same-PR repair fail-closed until actor-aware attribution exists.
- Last focused command: `npx tsx --test src/pull-request-state-policy.test.ts src/post-turn-pull-request.test.ts src/review-handling.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
