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
      startedAt: "2026-03-24T03:59:00Z",
      finishedAt: "2026-03-24T04:00:00Z",
    }),
    {
      schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
      issueNumber: 892,
      terminalState: "done",
      startedAt: "2026-03-24T03:59:00Z",
      finishedAt: "2026-03-24T04:00:00Z",
    },
  );

  assert.throws(
    () =>
      validateExecutionMetricsRunSummary({
        schemaVersion: 2,
        issueNumber: 892,
        terminalState: "done",
        startedAt: "2026-03-24T03:59:00Z",
        finishedAt: "2026-03-24T04:00:00Z",
      }),
    /schemaVersion must be 1/u,
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
      },
    }),
    /startedAt must be an ISO-8601 timestamp/u,
  );

  await assert.rejects(fs.stat(executionMetricsRunSummaryPath(workspacePath)), { code: "ENOENT" });
});
