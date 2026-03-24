import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
  EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS,
  validateExecutionMetricsRunSummary,
} from "./execution-metrics-schema";
import {
  executionMetricsRetentionRootPath,
  executionMetricsRunSummaryPath,
  retainedExecutionMetricsRunSummaryPath,
  syncExecutionMetricsRunSummary,
} from "./execution-metrics-run-summary";

test("validateExecutionMetricsRunSummary accepts the versioned contract and rejects unsupported schema versions", () => {
  const summary = {
    schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
    issueNumber: 892,
    terminalState: "done",
    terminalOutcome: {
      category: "completed",
      reason: "merged",
    },
    issueCreatedAt: "2026-03-24T03:55:00Z",
    startedAt: "2026-03-24T03:59:00Z",
    prCreatedAt: "2026-03-24T03:59:30Z",
    prMergedAt: "2026-03-24T03:59:45Z",
    finishedAt: "2026-03-24T04:00:00Z",
    runDurationMs: 60000,
    issueLeadTimeMs: 300000,
    issueToPrCreatedMs: 270000,
    prOpenDurationMs: 15000,
    reviewMetrics: {
      classification: "configured_bot_threads",
      iterationCount: 2,
      totalCount: 3,
      totalCountKind: "actionable_thread_instances",
    },
    failureMetrics: {
      classification: "latest_failure",
      category: "review",
      failureKind: "command_error",
      blockedReason: "verification",
      occurrenceCount: 2,
      lastOccurredAt: "2026-03-24T03:59:00Z",
    },
    recoveryMetrics: {
      classification: "latest_recovery",
      reason: "operator_requeue",
      occurrenceCount: 1,
      lastRecoveredAt: "2026-03-24T03:59:30Z",
      timeToLatestRecoveryMs: 30000,
    },
  } as const;

  assert.deepEqual(validateExecutionMetricsRunSummary(summary), summary);
  assert.deepEqual(Object.keys(summary).sort(), [...EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS].sort());

  assert.throws(
    () =>
      validateExecutionMetricsRunSummary({
        schemaVersion: 3,
        issueNumber: 892,
        terminalState: "done",
        terminalOutcome: {
          category: "completed",
          reason: "merged",
        },
        issueCreatedAt: "2026-03-24T03:55:00Z",
        startedAt: "2026-03-24T03:59:00Z",
        prCreatedAt: "2026-03-24T03:59:30Z",
        prMergedAt: "2026-03-24T03:59:45Z",
        finishedAt: "2026-03-24T04:00:00Z",
        runDurationMs: 60000,
        issueLeadTimeMs: 300000,
        issueToPrCreatedMs: 270000,
        prOpenDurationMs: 15000,
        reviewMetrics: null,
        failureMetrics: null,
        recoveryMetrics: null,
      }),
    /schemaVersion must be 4/u,
  );

  const { reviewMetrics, ...summaryWithoutReviewMetrics } = summary;
  void reviewMetrics;
  assert.throws(
    () => validateExecutionMetricsRunSummary(summaryWithoutReviewMetrics),
    /summary must contain schemaVersion, issueNumber, terminalState, terminalOutcome, issueCreatedAt, startedAt, prCreatedAt, prMergedAt, finishedAt, runDurationMs, issueLeadTimeMs, issueToPrCreatedMs, prOpenDurationMs, reviewMetrics, failureMetrics, and recoveryMetrics\./u,
  );
});

test("syncExecutionMetricsRunSummary rejects malformed run summaries before writing", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-schema-"));

  await assert.rejects(
    syncExecutionMetricsRunSummary({
      previousRecord: {
        issue_number: 892,
        updated_at: "not-an-iso-timestamp",
      },
      nextRecord: {
        state: "done",
        workspace: workspacePath,
        updated_at: "2026-03-24T04:00:00Z",
        blocked_reason: null,
        last_failure_kind: null,
        last_failure_context: null,
        repeated_failure_signature_count: 0,
        processed_review_thread_ids: [],
        last_recovery_reason: null,
        last_recovery_at: null,
        stale_stabilizing_no_pr_recovery_count: 0,
      },
    }),
    /startedAt must be an ISO-8601 timestamp/u,
  );

  await assert.rejects(fs.stat(executionMetricsRunSummaryPath(workspacePath)), { code: "ENOENT" });
});

test("validateExecutionMetricsRunSummary rejects negative derived lifecycle durations", () => {
  assert.throws(
    () =>
      validateExecutionMetricsRunSummary({
        schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
        issueNumber: 893,
        terminalState: "done",
        terminalOutcome: {
          category: "completed",
          reason: "merged",
        },
        issueCreatedAt: "2026-03-24T03:55:00Z",
        startedAt: "2026-03-24T03:59:00Z",
        prCreatedAt: "2026-03-24T04:01:00Z",
        prMergedAt: "2026-03-24T04:00:30Z",
        finishedAt: "2026-03-24T04:00:00Z",
        runDurationMs: 60000,
        issueLeadTimeMs: 300000,
        issueToPrCreatedMs: 360000,
        prOpenDurationMs: 0,
        reviewMetrics: null,
        failureMetrics: null,
        recoveryMetrics: null,
      }),
    /prOpenDurationMs timestamps must be chronological/u,
  );
});

test("syncExecutionMetricsRunSummary records coarse review metrics from processed review thread history", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-review-"));

  await syncExecutionMetricsRunSummary({
    previousRecord: {
      issue_number: 894,
      updated_at: "2026-03-24T04:00:00Z",
    },
    nextRecord: {
      state: "done",
      workspace: workspacePath,
      updated_at: "2026-03-24T04:05:00Z",
      blocked_reason: null,
      last_failure_kind: null,
      last_failure_context: null,
      repeated_failure_signature_count: 0,
      processed_review_thread_ids: ["thread-1@head-a", "thread-2@head-a", "thread-2@head-b"],
      last_recovery_reason: null,
      last_recovery_at: null,
      stale_stabilizing_no_pr_recovery_count: 0,
    },
    issue: {
      createdAt: "2026-03-24T03:55:00Z",
    },
    pullRequest: {
      createdAt: "2026-03-24T03:59:30Z",
      mergedAt: "2026-03-24T04:04:00Z",
    },
  });

  assert.deepEqual(
    JSON.parse(await fs.readFile(executionMetricsRunSummaryPath(workspacePath), "utf8")),
    {
      schemaVersion: 4,
      issueNumber: 894,
      terminalState: "done",
      terminalOutcome: {
        category: "completed",
        reason: "merged",
      },
      issueCreatedAt: "2026-03-24T03:55:00Z",
      startedAt: "2026-03-24T04:00:00Z",
      prCreatedAt: "2026-03-24T03:59:30Z",
      prMergedAt: "2026-03-24T04:04:00Z",
      finishedAt: "2026-03-24T04:05:00Z",
      runDurationMs: 300000,
      issueLeadTimeMs: 600000,
      issueToPrCreatedMs: 270000,
      prOpenDurationMs: 270000,
      reviewMetrics: {
        classification: "configured_bot_threads",
        iterationCount: 2,
        totalCount: 3,
        totalCountKind: "actionable_thread_instances",
      },
      failureMetrics: null,
      recoveryMetrics: null,
    },
  );
});

test("syncExecutionMetricsRunSummary retains a durable copy outside the workspace lifecycle", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-retained-"));
  const workspacePath = path.join(rootPath, "workspaces", "issue-895");
  const stateFilePath = path.join(rootPath, ".local", "state.json");
  const retentionRootPath = executionMetricsRetentionRootPath(stateFilePath);
  await fs.mkdir(workspacePath, { recursive: true });

  await syncExecutionMetricsRunSummary({
    previousRecord: {
      issue_number: 895,
      updated_at: "2026-03-24T04:00:00Z",
    },
    nextRecord: {
      state: "done",
      workspace: workspacePath,
      updated_at: "2026-03-24T04:05:00Z",
      blocked_reason: null,
      last_failure_kind: null,
      last_failure_context: null,
      repeated_failure_signature_count: 0,
      processed_review_thread_ids: [],
      last_recovery_reason: null,
      last_recovery_at: null,
      stale_stabilizing_no_pr_recovery_count: 0,
    },
    retentionRootPath,
  });

  const retainedPath = retainedExecutionMetricsRunSummaryPath(retentionRootPath, 895);
  assert.deepEqual(
    JSON.parse(await fs.readFile(retainedPath, "utf8")),
    JSON.parse(await fs.readFile(executionMetricsRunSummaryPath(workspacePath), "utf8")),
  );

  await fs.rm(workspacePath, { recursive: true, force: true });

  await assert.rejects(fs.stat(executionMetricsRunSummaryPath(workspacePath)), { code: "ENOENT" });
  assert.equal(JSON.parse(await fs.readFile(retainedPath, "utf8")).issueNumber, 895);
});
