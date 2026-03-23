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
    },
  );

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
      }),
    /schemaVersion must be 2/u,
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
      }),
    /prOpenDurationMs timestamps must be chronological/u,
  );
});
