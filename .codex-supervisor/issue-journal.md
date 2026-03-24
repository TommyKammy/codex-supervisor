# Issue #953: Schema contract discipline: require explicit schema-version bumps for required persisted and API contract changes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/953
- Branch: codex/issue-953
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: f3869480bdf0cdf32810dec6ab13ad5e842d1aaf
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T22:12:15Z

## Latest Codex Summary
Added explicit versioned contract discipline for the two issue-scoped surfaces and committed it as `f386948` on `codex/issue-953`.

The change exports and enforces the execution-metrics top-level schema keys in [src/supervisor/execution-metrics-schema.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-953/src/supervisor/execution-metrics-schema.ts), adds a dedicated post-merge audit summary validator in [src/supervisor/post-merge-audit-summary.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-953/src/supervisor/post-merge-audit-summary.ts), and tightens the focused tests in [src/supervisor/execution-metrics-schema.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-953/src/supervisor/execution-metrics-schema.test.ts) and [src/supervisor/post-merge-audit-summary.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-953/src/supervisor/post-merge-audit-summary.test.ts) so missing required fields and unsupported schema versions fail explicitly. I also updated the working notes in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-953/.codex-supervisor/issue-journal.md).

Verification passed after restoring dev dependencies with `npm ci`: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/execution-metrics-schema.test.ts` and `npm run build`. The untracked `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/` directories were left untouched.

Summary: Added explicit schema-contract validation and focused regression coverage for execution metrics and post-merge audit summary payloads; committed as `f386948`
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/execution-metrics-schema.test.ts`; `npm run build`
Next action: Open or update the draft PR for `codex/issue-953` with commit `f386948` and monitor CI
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: schema-versioned artifacts were validating value shapes, but the live code did not explicitly pin the required top-level contract for `ExecutionMetricsRunSummaryArtifact` and did not validate the API-facing `PostMergeAuditPatternSummaryDto` at all, so required-field contract changes could drift without an explicit schema-version discipline checkpoint.
- What changed: added focused regressions in `src/supervisor/execution-metrics-schema.test.ts` and `src/supervisor/post-merge-audit-summary.test.ts` that pin the current top-level required keys and reject unsupported schema versions or missing required fields; exported `EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS`; added explicit top-level key enforcement to `validateExecutionMetricsRunSummary`; added `validatePostMergeAuditPatternSummary()` plus nested DTO validation and routed `summarizePostMergeAuditPatterns()` through it.
- PR status: pushed `codex/issue-953` to `origin` and opened draft PR #968 (`https://github.com/TommyKammy/codex-supervisor/pull/968`).
- Current blocker: none.
- Next exact step: monitor PR #968 CI, then address any review or build feedback and move the PR out of draft when ready.
- Verification gap: none in the requested scope; after restoring dev dependencies with `npm ci`, `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/execution-metrics-schema.test.ts` and `npm run build` both passed.
- Files touched: `src/supervisor/execution-metrics-schema.ts`, `src/supervisor/execution-metrics-schema.test.ts`, `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; runtime behavior only gains stricter contract validation for already-versioned summary payloads.
- Last focused command: `gh pr create --draft --base main --head codex/issue-953 --title "Issue #953: Enforce explicit versioned schema contracts" --body ...`
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
