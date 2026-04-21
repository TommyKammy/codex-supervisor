# Issue #1610: Make explain detect tracked PR numbers and report owning issue context

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1610
- Branch: codex/issue-1610
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 37458be151d9ef6a82eb5fc9bc447f2700d71ced
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-21T12:53:29.674Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `explain <number>` should resolve through the authoritative tracked record when `<number>` matches `record.pr_number`, then render the owning issue context instead of treating the PR body as a schedulable issue.
- What changed: Added tracked-PR explain regressions in the helper and end-to-end diagnostics tests, then taught `buildIssueExplainDto` to map PR-number lookups to the owning issue and emit a `lookup_target=tracked_pr ...` diagnostic with branch, tracked state, blocked reason, and PR state.
- Current blocker: None for the issue scope. The repo's `npm test -- src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts` wrapper still expands to the full suite and currently fails in unrelated `supervisor-status-model-supervisor.test.ts` pre-merge evaluation expectations.
- Next exact step: Commit the explain-path change on `codex/issue-1610`; if the supervisor requires the exact npm wrapper to be green, investigate the unrelated `repair=none` expectation drift in `src/supervisor/supervisor-status-model-supervisor.test.ts`.
- Verification gap: Focused explain regressions and `npm run build` are green. The exact npm wrapper command is not a clean focused gate in this repo and currently fails outside this issue's changed area.
- Files touched: .codex-supervisor/issue-journal.md; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-selection-issue-explain.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts
- Rollback concern: Low. The new lookup branch only activates when a requested number matches exactly one tracked `pr_number`; normal issue-number explain behavior is unchanged.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
