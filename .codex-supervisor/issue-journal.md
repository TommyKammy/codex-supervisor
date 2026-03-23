# Issue #896: Execution metrics aggregation: generate daily rollups from persisted run summaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/896
- Branch: codex/issue-896
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 59a5f5095484b50f531684ef5ed2ad5339b1f494
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852O2yV
- Repeated failure signature count: 1
- Updated at: 2026-03-23T20:06:23.960Z

## Latest Codex Summary
Implemented daily execution-metrics rollups in [src/supervisor/execution-metrics-aggregation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-896/src/supervisor/execution-metrics-aggregation.ts) and added the focused reproducer in [src/supervisor/execution-metrics-aggregation.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-896/src/supervisor/execution-metrics-aggregation.test.ts). The helper reads persisted run summaries, validates them, groups by UTC `finishedAt` day, and emits machine-readable daily aggregates for lead time, review-loop counts, terminal states, and failure patterns without touching execution behavior.

I committed the work as `216d0ab` and the follow-up journal update as `59a5f50`, pushed `codex/issue-896`, and opened draft PR [#909](https://github.com/TommyKammy/codex-supervisor/pull/909). The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Added standalone daily rollup generation for persisted execution-metrics run summaries, verified by a new focused test and a passing build, and opened draft PR #909.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/execution-metrics-aggregation.test.ts`; `npm run build`
Failure signature: none
Next action: Inspect draft PR #909 and decide whether the remaining scope needs a CLI or supervisor-managed invocation path for the new rollup artifact.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/909#discussion_r2977282636
- Details:
  - src/supervisor/execution-metrics-aggregation.ts:145 _⚠️ Potential issue_ | _🟠 Major_ **Don't drop `failureMetrics.occurrenceCount`.** Line 136 and Line 144 always add `1`, so a run that recorded the same failure twice is rolled up as `{ count: 1 }`. That under-reports the daily failure frequency and makes `failurePatterns[].count` misleading. <details> <summary>Suggested fix</summary> ```diff function addFailurePattern( accumulator: ExecutionMetricsDailyRollupAccumulator, failureMetrics: ExecutionMetricsFailureMetrics | null, ): void { if (failureMetrics === null) { return; } const key = failurePatternKey(failureMetrics); const existing = accumulator.failurePatterns.get(key); if (existing) { - existing.count += 1; + existing.count += failureMetrics.occurrenceCount; return; } accumulator.failurePatterns.set(key, { category: failureMetrics.category, failureKind: failureMetrics.failureKind, blockedReason: failureMetrics.blockedReason, - count: 1, + count: failureMetrics.occurrenceCount, }); } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion function addFailurePattern( accumulator: ExecutionMetricsDailyRollupAccumulator, failureMetrics: ExecutionMetricsFailureMetrics | null, ): void { if (failureMetrics === null) { return; } const key = failurePatternKey(failureMetrics); const existing = accumulator.failurePatterns.get(key); if (existing) { existing.count += failureMetrics.occurrenceCount; return; } accumulator.failurePatterns.set(key, { category: failureMetrics.category, failureKind: failureMetrics.failureKind, blockedReason: failureMetrics.blockedReason, count: failureMetrics.occurrenceCount, }); } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/execution-metrics-aggregation.ts` around lines 125 - 145, The addFailurePattern function currently increments pattern counts by a hardcoded 1, losing multi-occurrence data; update it to use failureMetrics.occurrenceCount (falling back to 1 if undefined) when both updating an existing entry (add occurrenceCount to existing.count) and when creating a new entry (set count to occurrenceCount or 1). Refer to addFailurePattern, accumulator.failurePatterns, and failurePatternKey to locate the change. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread is valid because `addFailurePattern` ignores `failureMetrics.occurrenceCount`; daily failure-pattern rollups need to sum the recorded per-run occurrence counts rather than treating every failure summary as exactly one occurrence.
- What changed: updated `src/supervisor/execution-metrics-aggregation.ts` so `addFailurePattern` uses `failureMetrics.occurrenceCount` when creating and updating daily failure-pattern entries; extended `src/supervisor/execution-metrics-aggregation.test.ts` with a second same-day `codex/command_error` run so the focused test exercises the existing-entry path and expects an aggregated count of `5`; committed the fix as `b4b2aee` (`Preserve failure occurrence counts in rollups`) and pushed `codex/issue-896` to refresh PR #909.
- Current blocker: none
- Next exact step: monitor PR #909 for any follow-up review or CI after the pushed fix and resolved review thread.
- Verification gap: none in the requested scope; `npx tsx --test src/supervisor/execution-metrics-aggregation.test.ts` and `npm run build` pass after the fix.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/execution-metrics-aggregation.test.ts`, `src/supervisor/execution-metrics-aggregation.ts`
- Rollback concern: low; the change only affects additive reporting for daily failure-pattern counts and a focused test, without touching issue execution.
- Last focused command: `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ852O2yV"}) { thread { isResolved } } }'`
- Last focused failure: automated review thread `PRRT_kwDORgvdZ852O2yV` correctly identified that failure-pattern rollups undercount repeated failures by incrementing with a hardcoded `1`; no local verification failures remain after the fix.
- Last focused commands:
```bash
git status --short
sed -n '110,190p' src/supervisor/execution-metrics-aggregation.ts
rg -n "failurePatterns|occurrenceCount|addFailurePattern" src/supervisor/execution-metrics-aggregation.test.ts src/supervisor/execution-metrics-aggregation.ts
sed -n '1,260p' src/supervisor/execution-metrics-aggregation.test.ts
sed -n '1,120p' src/supervisor/execution-metrics-schema.ts
git diff -- .codex-supervisor/issue-journal.md
sed -n '1,220p' src/supervisor/execution-metrics-aggregation.ts
apply_patch
apply_patch
npx tsx --test src/supervisor/execution-metrics-aggregation.test.ts
npm run build
git diff -- src/supervisor/execution-metrics-aggregation.ts src/supervisor/execution-metrics-aggregation.test.ts
git rev-parse HEAD
git add .codex-supervisor/issue-journal.md src/supervisor/execution-metrics-aggregation.ts src/supervisor/execution-metrics-aggregation.test.ts
git commit -m "Preserve failure occurrence counts in rollups"
git push origin codex/issue-896
git add .codex-supervisor/issue-journal.md
git commit -m "Update issue 896 journal"
git push origin codex/issue-896
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ852O2yV"}) { thread { isResolved } } }'
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
