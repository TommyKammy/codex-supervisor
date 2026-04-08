# Issue #1337: Enhancement: auto-repair current-head fix_blocked local-review findings on tracked PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1337
- Branch: codex/issue-1337
- Workspace: .
- Journal: .codex-supervisor/issues/1337/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f68dba540d4ad3edea4da441f29879f78a1fefda
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T07:11:44.508Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Current-head local-review `fix_blocked` results were still treated as inert verification blockers instead of entering the bounded same-PR repair lane that `follow_up_eligible` and `manual_review_blocked` already use.
- What changed: Added a dedicated `fix_blocked` same-PR repair predicate, routed it through pull-request state inference and retry-loop convergence, updated post-turn/pre-merge operator-facing repair labels and summaries, and added focused coverage for helper, policy, post-turn, and pre-merge DTO behavior.
- Current blocker: none
- Next exact step: Commit the focused fix and, if requested by the supervisor loop, open/update the draft PR for branch `codex/issue-1337`.
- Verification gap: Full `npm test` wrapper was not used for signal because it runs unrelated suites and hit an existing unrelated browser-helper failure; focused `tsx --test` runs and `tsc --noEmit` are green.
- Files touched: src/review-handling.ts; src/review-handling.test.ts; src/pull-request-state.ts; src/pull-request-state-policy.test.ts; src/post-turn-pull-request.test.ts; src/supervisor/supervisor-pre-merge-evaluation.ts; src/supervisor/supervisor-pre-merge-evaluation.test.ts; src/turn-execution-orchestration.ts; src/codex/codex-prompt.ts
- Rollback concern: Low; behavior change is intentionally limited to current-head `fix_blocked` residuals on otherwise clean tracked PR lanes, but reverting should keep the helper/state/prompt/DTO changes together.
- Last focused command: npx tsx --test src/turn-execution-orchestration.test.ts && npx tsx --test src/codex/codex-prompt.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
