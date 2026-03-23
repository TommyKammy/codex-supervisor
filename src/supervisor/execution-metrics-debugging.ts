import fs from "node:fs/promises";
import { parseJson } from "../core/utils";
import { executionMetricsRunSummaryPath } from "./execution-metrics-run-summary";
import {
  type ExecutionMetricsRunSummaryArtifact,
  validateExecutionMetricsRunSummary,
} from "./execution-metrics-schema";

function formatMetricValue(value: number | string | null): string {
  return value === null ? "none" : String(value);
}

export function formatExecutionMetricsSummaryLines(
  summary: ExecutionMetricsRunSummaryArtifact,
): string[] {
  const lines = [
    [
      "execution_metrics",
      `terminal_state=${summary.terminalState}`,
      `outcome=${summary.terminalOutcome.category}`,
      `reason=${summary.terminalOutcome.reason ?? "none"}`,
      `run_duration_ms=${summary.runDurationMs}`,
      `issue_lead_time_ms=${formatMetricValue(summary.issueLeadTimeMs)}`,
      `issue_to_pr_created_ms=${formatMetricValue(summary.issueToPrCreatedMs)}`,
      `pr_open_duration_ms=${formatMetricValue(summary.prOpenDurationMs)}`,
    ].join(" "),
  ];

  if (summary.reviewMetrics) {
    lines.push([
      "execution_metrics_review",
      `classification=${summary.reviewMetrics.classification}`,
      `iterations=${summary.reviewMetrics.iterationCount}`,
      `actionable_threads=${summary.reviewMetrics.totalCount}`,
      `count_kind=${summary.reviewMetrics.totalCountKind}`,
    ].join(" "));
  }

  if (summary.failureMetrics) {
    lines.push([
      "execution_metrics_failure",
      `category=${summary.failureMetrics.category}`,
      `failure_kind=${summary.failureMetrics.failureKind ?? "none"}`,
      `blocked_reason=${summary.failureMetrics.blockedReason ?? "none"}`,
      `occurrences=${summary.failureMetrics.occurrenceCount}`,
      `last_occurred_at=${summary.failureMetrics.lastOccurredAt}`,
    ].join(" "));
  }

  if (summary.recoveryMetrics) {
    lines.push([
      "execution_metrics_recovery",
      `reason=${summary.recoveryMetrics.reason}`,
      `occurrences=${summary.recoveryMetrics.occurrenceCount}`,
      `last_recovered_at=${summary.recoveryMetrics.lastRecoveredAt}`,
      `time_to_latest_recovery_ms=${formatMetricValue(summary.recoveryMetrics.timeToLatestRecoveryMs)}`,
    ].join(" "));
  }

  return lines;
}

export async function loadExecutionMetricsSummaryLines(workspacePath: string | null): Promise<string[]> {
  if (!workspacePath) {
    return [];
  }

  const summaryPath = executionMetricsRunSummaryPath(workspacePath);
  let raw: string;
  try {
    raw = await fs.readFile(summaryPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const parsed = parseJson<ExecutionMetricsRunSummaryArtifact>(raw, summaryPath);
  return formatExecutionMetricsSummaryLines(validateExecutionMetricsRunSummary(parsed));
}
