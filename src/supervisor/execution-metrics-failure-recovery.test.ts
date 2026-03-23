import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionMetricsRunSummaryArtifact } from "./execution-metrics-lifecycle";

test("buildExecutionMetricsRunSummaryArtifact records structured failure and recovery summaries when present", () => {
  assert.deepEqual(
    buildExecutionMetricsRunSummaryArtifact({
      issueNumber: 895,
      terminalState: "blocked",
      issueCreatedAt: "2026-03-24T00:00:00Z",
      startedAt: "2026-03-24T00:01:00Z",
      finishedAt: "2026-03-24T00:09:00Z",
      blockedReason: "verification",
      failureKind: "command_error",
      failureContext: {
        category: "review",
        summary: "Verification failed",
        signature: "verify-failed",
        command: "npm test",
        details: ["suite=supervisor"],
        url: "https://example.test/issues/895",
        updated_at: "2026-03-24T00:04:00Z",
      },
      repeatedFailureSignatureCount: 2,
      recoveryEvents: [
        {
          issueNumber: 895,
          reason: "operator_requeue: requeued issue #895 from blocked to queued",
          at: "2026-03-24T00:06:00Z",
        },
      ],
      lastRecoveryReason: "operator_requeue: requeued issue #895 from blocked to queued",
      lastRecoveryAt: "2026-03-24T00:06:00Z",
    }),
    {
      schemaVersion: 4,
      issueNumber: 895,
      terminalState: "blocked",
      terminalOutcome: {
        category: "blocked",
        reason: "verification",
      },
      issueCreatedAt: "2026-03-24T00:00:00Z",
      startedAt: "2026-03-24T00:01:00Z",
      prCreatedAt: null,
      prMergedAt: null,
      finishedAt: "2026-03-24T00:09:00Z",
      runDurationMs: 480000,
      issueLeadTimeMs: 540000,
      issueToPrCreatedMs: null,
      prOpenDurationMs: null,
      reviewMetrics: null,
      failureMetrics: {
        classification: "latest_failure",
        category: "review",
        failureKind: "command_error",
        blockedReason: "verification",
        occurrenceCount: 2,
        lastOccurredAt: "2026-03-24T00:04:00Z",
      },
      recoveryMetrics: {
        classification: "latest_recovery",
        reason: "operator_requeue",
        occurrenceCount: 1,
        lastRecoveredAt: "2026-03-24T00:06:00Z",
        timeToLatestRecoveryMs: 120000,
      },
    },
  );
});

test("buildExecutionMetricsRunSummaryArtifact keeps successful runs without failures free of synthetic failure summaries", () => {
  assert.deepEqual(
    buildExecutionMetricsRunSummaryArtifact({
      issueNumber: 895,
      terminalState: "done",
      issueCreatedAt: "2026-03-24T00:00:00Z",
      startedAt: "2026-03-24T00:01:00Z",
      prCreatedAt: "2026-03-24T00:02:00Z",
      prMergedAt: "2026-03-24T00:05:00Z",
      finishedAt: "2026-03-24T00:06:00Z",
    }),
    {
      schemaVersion: 4,
      issueNumber: 895,
      terminalState: "done",
      terminalOutcome: {
        category: "completed",
        reason: "merged",
      },
      issueCreatedAt: "2026-03-24T00:00:00Z",
      startedAt: "2026-03-24T00:01:00Z",
      prCreatedAt: "2026-03-24T00:02:00Z",
      prMergedAt: "2026-03-24T00:05:00Z",
      finishedAt: "2026-03-24T00:06:00Z",
      runDurationMs: 300000,
      issueLeadTimeMs: 360000,
      issueToPrCreatedMs: 120000,
      prOpenDurationMs: 180000,
      reviewMetrics: null,
      failureMetrics: null,
      recoveryMetrics: null,
    },
  );
});
