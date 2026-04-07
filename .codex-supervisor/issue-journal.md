# Issue #1324: [codex] Make local-review follow-up issue creation advisory by default

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1324
- Branch: codex/issue-1324
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ec217e8246c3bdfec9b7520c2fae164983789204
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T02:35:58.329Z

## Latest Codex Summary
- Made local-review `follow_up_eligible` residuals advisory by default, preserved follow-up issue creation behind an explicit config opt-in, and tightened the generated opt-in issue body to use canonical codex scheduling metadata.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The only default-mutating path is `handlePostTurnPullRequestTransitionsPhase`, so gating residual issue creation there should preserve `follow_up_eligible` visibility in artifacts/status while stopping automatic GitHub issue writes.
- What changed: Added `localReviewFollowUpIssueCreationEnabled` with a default of `false`; changed post-turn PR handling so `follow_up_eligible` only creates GitHub issues when that flag is explicitly enabled; sanitized inherited verification lines so opt-in-generated codex issues do not copy scheduling metadata into `## Verification`; updated the generated issue body to use canonical `Parallelizable` plus `## Execution order` metadata; added focused tests for the new default and opt-in path.
- Current blocker: none
- Next exact step: Commit the verified change set on `codex/issue-1324`.
- Verification gap: none after focused tests and build passed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `src/core/types.ts`, `src/core/config.ts`, `src/config.test.ts`, `src/turn-execution-test-helpers.ts`
- Rollback concern: Low; the behavioral change is isolated to follow-up issue creation after local review and defaults fail closed to no GitHub mutation.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
