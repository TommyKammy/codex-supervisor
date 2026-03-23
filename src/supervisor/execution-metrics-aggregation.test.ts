import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildExecutionMetricsDailyRollupsArtifact,
  syncExecutionMetricsDailyRollups,
} from "./execution-metrics-aggregation";
import type { ExecutionMetricsRunSummaryArtifact } from "./execution-metrics-schema";

function createRunSummary(
  issueNumber: number,
  overrides: Partial<ExecutionMetricsRunSummaryArtifact> = {},
): ExecutionMetricsRunSummaryArtifact {
  return {
    schemaVersion: 4,
    issueNumber,
    terminalState: "done",
    terminalOutcome: {
      category: "completed",
      reason: "merged",
    },
    issueCreatedAt: "2026-03-24T00:00:00Z",
    startedAt: "2026-03-24T01:00:00Z",
    prCreatedAt: "2026-03-24T01:30:00Z",
    prMergedAt: "2026-03-24T02:30:00Z",
    finishedAt: "2026-03-24T03:00:00Z",
    runDurationMs: 7_200_000,
    issueLeadTimeMs: 10_800_000,
    issueToPrCreatedMs: 5_400_000,
    prOpenDurationMs: 3_600_000,
    reviewMetrics: {
      classification: "configured_bot_threads",
      iterationCount: 2,
      totalCount: 4,
      totalCountKind: "actionable_thread_instances",
    },
    failureMetrics: null,
    recoveryMetrics: null,
    ...overrides,
  };
}

async function writeRunSummary(
  rootPath: string,
  workspaceName: string,
  summary: ExecutionMetricsRunSummaryArtifact,
): Promise<string> {
  const filePath = path.join(rootPath, workspaceName, ".codex-supervisor", "execution-metrics", "run-summary.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return filePath;
}

test("daily rollups aggregate persisted run summaries by finished-at day", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-rollups-"));
  const summaries = [
    createRunSummary(101),
    createRunSummary(102, {
      terminalState: "blocked",
      terminalOutcome: {
        category: "blocked",
        reason: "verification",
      },
      startedAt: "2026-03-24T09:00:00Z",
      prCreatedAt: "2026-03-24T09:20:00Z",
      prMergedAt: null,
      finishedAt: "2026-03-24T10:00:00Z",
      runDurationMs: 3_600_000,
      issueLeadTimeMs: 36_000_000,
      issueToPrCreatedMs: 33_600_000,
      prOpenDurationMs: null,
      reviewMetrics: {
        classification: "configured_bot_threads",
        iterationCount: 1,
        totalCount: 2,
        totalCountKind: "actionable_thread_instances",
      },
      failureMetrics: {
        classification: "latest_failure",
        category: "blocked",
        failureKind: null,
        blockedReason: "verification",
        occurrenceCount: 1,
        lastOccurredAt: "2026-03-24T10:00:00Z",
      },
    }),
    createRunSummary(103, {
      terminalState: "failed",
      terminalOutcome: {
        category: "failed",
        reason: "command_error",
      },
      issueCreatedAt: "2026-03-24T23:00:00Z",
      startedAt: "2026-03-25T02:00:00Z",
      prCreatedAt: null,
      prMergedAt: null,
      finishedAt: "2026-03-25T03:00:00Z",
      runDurationMs: 3_600_000,
      issueLeadTimeMs: 14_400_000,
      issueToPrCreatedMs: null,
      prOpenDurationMs: null,
      reviewMetrics: null,
      failureMetrics: {
        classification: "latest_failure",
        category: "codex",
        failureKind: "command_error",
        blockedReason: null,
        occurrenceCount: 2,
        lastOccurredAt: "2026-03-25T03:00:00Z",
      },
    }),
  ];
  const runSummaryPaths = await Promise.all([
    writeRunSummary(rootPath, "issue-101", summaries[0]),
    writeRunSummary(
      rootPath,
      "issue-102",
      summaries[1],
    ),
    writeRunSummary(
      rootPath,
      "issue-103",
      summaries[2],
    ),
  ]);

  const artifact = buildExecutionMetricsDailyRollupsArtifact({
    generatedAt: "2026-03-26T00:00:00Z",
    runSummaries: runSummaryPaths.map((summaryPath, index) => ({
      summaryPath,
      summary: summaries[index],
    })),
  });

  assert.deepEqual(artifact, {
    schemaVersion: 1,
    generatedAt: "2026-03-26T00:00:00Z",
    days: [
      {
        day: "2026-03-24",
        runCount: 2,
        terminalStates: {
          done: 1,
          blocked: 1,
          failed: 0,
        },
        leadTimeMs: {
          average: 23_400_000,
          total: 46_800_000,
          count: 2,
        },
        reviewIterations: {
          average: 1.5,
          total: 3,
          count: 2,
        },
        reviewThreadInstances: {
          average: 3,
          total: 6,
          count: 2,
        },
        failurePatterns: [
          {
            category: "blocked",
            failureKind: null,
            blockedReason: "verification",
            count: 1,
          },
        ],
      },
      {
        day: "2026-03-25",
        runCount: 1,
        terminalStates: {
          done: 0,
          blocked: 0,
          failed: 1,
        },
        leadTimeMs: {
          average: 14_400_000,
          total: 14_400_000,
          count: 1,
        },
        reviewIterations: {
          average: null,
          total: 0,
          count: 0,
        },
        reviewThreadInstances: {
          average: null,
          total: 0,
          count: 0,
        },
        failurePatterns: [
          {
            category: "codex",
            failureKind: "command_error",
            blockedReason: null,
            count: 1,
          },
        ],
      },
    ],
  });

  const outputPath = path.join(rootPath, ".codex-supervisor", "execution-metrics", "daily-rollups.json");
  const context = await syncExecutionMetricsDailyRollups({
    outputPath,
    runSummaryPaths,
    generatedAt: "2026-03-26T00:00:00Z",
  });

  assert.equal(context.artifactPath, outputPath);
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, "utf8")), artifact);
});
