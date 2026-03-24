# Issue #953: Schema contract discipline: require explicit schema-version bumps for required persisted and API contract changes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/953
- Branch: codex/issue-953
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 37e80a26ee66f057dc443f940b2b7ead6d2cf890
- Blocked reason: none
- Last failure signature: missing-versioned-contract-validation
- Repeated failure signature count: 0
- Updated at: 2026-03-24T21:58:09Z

## Latest Codex Summary
- Added explicit versioned contract validation for execution metrics run summaries and post-merge audit summary DTOs, plus focused tests that pin the current required top-level fields.

## Active Failure Context
- Resolved in this turn: the focused reproducer showed the contract discipline gap as missing version-aware validation exports for post-merge audit summaries and missing explicit required top-level key checks for execution metrics.

## Codex Working Notes
### Current Handoff
- Hypothesis: schema-versioned artifacts were validating value shapes, but the live code did not explicitly pin the required top-level contract for `ExecutionMetricsRunSummaryArtifact` and did not validate the API-facing `PostMergeAuditPatternSummaryDto` at all, so required-field contract changes could drift without an explicit schema-version discipline checkpoint.
- What changed: added focused regressions in `src/supervisor/execution-metrics-schema.test.ts` and `src/supervisor/post-merge-audit-summary.test.ts` that pin the current top-level required keys and reject unsupported schema versions or missing required fields; exported `EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS`; added explicit top-level key enforcement to `validateExecutionMetricsRunSummary`; added `validatePostMergeAuditPatternSummary()` plus nested DTO validation and routed `summarizePostMergeAuditPatterns()` through it.
- Current blocker: none.
- Next exact step: commit the schema-contract discipline checkpoint on `codex/issue-953`, then open or update the draft PR if needed.
- Verification gap: none in the requested scope; after restoring dev dependencies with `npm ci`, `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/execution-metrics-schema.test.ts` and `npm run build` both passed.
- Files touched: `src/supervisor/execution-metrics-schema.ts`, `src/supervisor/execution-metrics-schema.test.ts`, `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; runtime behavior only gains stricter contract validation for already-versioned summary payloads.
- Last focused command: `npm run build`
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
