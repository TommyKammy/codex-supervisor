# Issue #895: Execution metrics failure and recovery: record structured failure and recovery summaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/895
- Branch: codex/issue-895
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e998202c3cf1ae538515dc42f0cc78e94ad0d4e4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T19:12:40.085Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #895 can be satisfied by extending the execution-metrics run-summary contract with nullable `failureMetrics` and `recoveryMetrics` blocks derived from already persisted failure/recovery state plus in-flight `RecoveryEvent`s, so metrics improve without changing retry, recovery, or stop decisions.
- What changed: added a focused reproducer in `src/supervisor/execution-metrics-failure-recovery.test.ts`; bumped `src/supervisor/execution-metrics-schema.ts` to schema version 4 with nullable `failureMetrics` and `recoveryMetrics` blocks plus validation rules; updated `src/supervisor/execution-metrics-lifecycle.ts` to derive latest failure metrics from `last_failure_context`/`last_failure_kind`/`blocked_reason` and latest recovery metrics from issue-scoped `RecoveryEvent`s or persisted `last_recovery_*`; threaded the extra state through `src/supervisor/execution-metrics-run-summary.ts`, `src/run-once-issue-preparation.ts`, and `src/supervisor/supervisor.ts`; refreshed `src/supervisor/execution-metrics-schema.test.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, and `src/supervisor/execution-metrics-run-summary.test.ts` for the version-4 contract.
- Current blocker: none
- Next exact step: stage the execution-metrics changes, commit the issue-895 checkpoint, and then open or update the branch PR if supervisor policy requires it this turn.
- Verification gap: none in the requested scope after `npm ci`; `npm run build`, `npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`, and the focused execution-metrics suite all pass.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/run-once-issue-preparation.ts`, `src/supervisor/execution-metrics-failure-recovery.test.ts`, `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, `src/supervisor/execution-metrics-run-summary.ts`, `src/supervisor/execution-metrics-run-summary.test.ts`, `src/supervisor/execution-metrics-schema.ts`, `src/supervisor/execution-metrics-schema.test.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: medium; schema version 4 extends persisted run-summary artifacts, so downstream consumers pinned to version 3 need to tolerate or migrate to the new failure/recovery blocks.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` first failed with `sh: 1: tsc: not found` because this worktree lacked `node_modules`; after `npm ci`, a subsequent build surfaced a TypeScript scope error in `src/supervisor/supervisor.ts` from passing `recoveryEvents` outside its context, and threading `recoveryEvents` through `runPreparedIssue` resolved it.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-895/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-895/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current && git rev-parse HEAD
rg -n "failure|recovery|run summary|runSummary|execution metrics|structured" src/supervisor src --glob '!node_modules'
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.ts
sed -n '1,320p' src/supervisor/execution-metrics-lifecycle.ts
sed -n '1,320p' src/supervisor/supervisor-recovery-reconciliation.test.ts
sed -n '1,360p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '1,280p' src/supervisor/execution-metrics-schema.test.ts
sed -n '1,260p' src/supervisor/execution-metrics-lifecycle.test.ts
sed -n '1,320p' src/recovery-reconciliation.ts
sed -n '1,260p' src/run-once-cycle-prelude.ts
sed -n '280,440p' src/run-once-issue-preparation.ts
sed -n '420,620p' src/run-once-turn-execution.ts
sed -n '620,820p' src/supervisor/supervisor.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts
npx tsx --test src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-run-summary.test.ts
apply_patch
npx tsx -e 'import { buildExecutionMetricsRunSummaryArtifact } from "./src/supervisor/execution-metrics-lifecycle.ts"; console.log(JSON.stringify(buildExecutionMetricsRunSummaryArtifact({ issueNumber: 894, terminalState: "done", issueCreatedAt: "2026-03-24T03:55:00Z", startedAt: "2026-03-24T04:00:00Z", prCreatedAt: "2026-03-24T03:59:30Z", prMergedAt: "2026-03-24T04:04:00Z", finishedAt: "2026-03-24T04:05:00Z", blockedReason: null, failureKind: null, failureContext: null, repeatedFailureSignatureCount: 0, processedReviewThreadIds: ["thread-1@head-a","thread-2@head-a","thread-2@head-b"], lastRecoveryReason: null, lastRecoveryAt: null, staleStabilizingNoPrRecoveryCount: 0 }), null, 2));'
npx tsx --test src/supervisor/execution-metrics-schema.test.ts
npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts
npx tsx --test src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-run-summary.test.ts
npm run build
npm ci
npm run build
npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts
git status --short
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
