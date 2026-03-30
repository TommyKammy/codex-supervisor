import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionMetricsRunSummaryArtifact } from "./execution-metrics-lifecycle";

test("buildExecutionMetricsRunSummaryArtifact derives lead-time and PR milestone durations", () => {
  assert.deepEqual(
    buildExecutionMetricsRunSummaryArtifact({
      issueNumber: 893,
      terminalState: "done",
      issueCreatedAt: "2026-03-24T00:00:00Z",
      startedAt: "2026-03-24T00:01:00Z",
      prCreatedAt: "2026-03-24T00:03:00Z",
      prMergedAt: "2026-03-24T00:05:00Z",
      finishedAt: "2026-03-24T00:06:00Z",
      processedReviewThreadIds: ["thread-1@head-a", "thread-2@head-a", "thread-2@head-b"],
    }),
    {
      schemaVersion: 4,
      issueNumber: 893,
      terminalState: "done",
      terminalOutcome: {
        category: "completed",
        reason: "merged",
      },
      issueCreatedAt: "2026-03-24T00:00:00Z",
      startedAt: "2026-03-24T00:01:00Z",
      prCreatedAt: "2026-03-24T00:03:00Z",
      prMergedAt: "2026-03-24T00:05:00Z",
      finishedAt: "2026-03-24T00:06:00Z",
      runDurationMs: 300000,
      issueLeadTimeMs: 360000,
      issueToPrCreatedMs: 180000,
      prOpenDurationMs: 120000,
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

test("buildExecutionMetricsRunSummaryArtifact rejects negative chronology", () => {
  assert.throws(
    () =>
      buildExecutionMetricsRunSummaryArtifact({
        issueNumber: 893,
        terminalState: "done",
        issueCreatedAt: "2026-03-24T00:00:00Z",
        startedAt: "2026-03-24T00:06:00Z",
        prCreatedAt: "2026-03-24T00:03:00Z",
        prMergedAt: "2026-03-24T00:05:00Z",
        finishedAt: "2026-03-24T00:04:00Z",
      }),
    /Invalid execution metrics chronology/u,
  );
});

test("buildExecutionMetricsRunSummaryArtifact omits derived recovery timing when retained recovery predates the latest failure", () => {
  assert.deepEqual(
    buildExecutionMetricsRunSummaryArtifact({
      issueNumber: 893,
      terminalState: "blocked",
      issueCreatedAt: "2026-03-24T00:00:00Z",
      startedAt: "2026-03-24T00:01:00Z",
      finishedAt: "2026-03-24T00:06:00Z",
      blockedReason: "verification",
      failureContext: {
        category: "blocked",
        summary: "Verification is still blocked.",
        signature: "verification-blocked",
        command: null,
        details: [],
        url: null,
        updated_at: "2026-03-24T00:05:00Z",
      },
      lastRecoveryReason: "tracked_pr_lifecycle_recovered: reused PR facts",
      lastRecoveryAt: "2026-03-24T00:04:00Z",
    }).recoveryMetrics,
    {
      classification: "latest_recovery",
      reason: "tracked_pr_lifecycle_recovered",
      occurrenceCount: 1,
      lastRecoveredAt: "2026-03-24T00:04:00Z",
      timeToLatestRecoveryMs: null,
    },
  );
});
