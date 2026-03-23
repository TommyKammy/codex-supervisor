import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
  validateExecutionMetricsRunSummary,
} from "./execution-metrics-schema";
import { executionMetricsRunSummaryPath, syncExecutionMetricsRunSummary } from "./execution-metrics-run-summary";

test("validateExecutionMetricsRunSummary accepts the versioned contract and rejects unsupported schema versions", () => {
  assert.deepEqual(
    validateExecutionMetricsRunSummary({
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
    }),
    {
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
    },
  );

  assert.throws(
    () =>
      validateExecutionMetricsRunSummary({
        schemaVersion: 2,
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
      }),
    /schemaVersion must be 3/u,
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
        processed_review_thread_ids: [],
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
      processed_review_thread_ids: ["thread-1@head-a", "thread-2@head-a", "thread-2@head-b"],
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
      schemaVersion: 3,
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
    },
  );
});
