import type { BlockedReason, FailureKind } from "../core/types";
import {
  EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
  type ExecutionMetricsReviewMetrics,
  type ExecutionMetricsRunSummaryArtifact,
  type ExecutionMetricsTerminalOutcome,
} from "./execution-metrics-schema";

function durationMs(start: string | null, end: string | null): number | null {
  if (start === null || end === null) {
    return null;
  }

  const duration = Date.parse(end) - Date.parse(start);
  if (duration < 0) {
    throw new Error(`Invalid execution metrics chronology: ${start} must be at or before ${end}.`);
  }

  return duration;
}

function terminalOutcomeForState(args: {
  terminalState: ExecutionMetricsRunSummaryArtifact["terminalState"];
  blockedReason?: BlockedReason | null;
  failureKind?: FailureKind;
  prMergedAt?: string | null;
}): ExecutionMetricsTerminalOutcome {
  if (args.terminalState === "done") {
    return {
      category: "completed",
      reason: args.prMergedAt ? "merged" : null,
    };
  }

  if (args.terminalState === "blocked") {
    return {
      category: "blocked",
      reason: args.blockedReason ?? "unknown",
    };
  }

  return {
    category: "failed",
    reason: args.failureKind ?? "unknown",
  };
}

function buildReviewMetrics(processedReviewThreadIds: string[]): ExecutionMetricsReviewMetrics | null {
  const scopedThreadKeys = Array.from(new Set(processedReviewThreadIds));
  if (scopedThreadKeys.length === 0) {
    return null;
  }

  const iterationHeads = new Set<string>();
  for (const scopedThreadKey of scopedThreadKeys) {
    const atIndex = scopedThreadKey.lastIndexOf("@");
    if (atIndex <= 0 || atIndex === scopedThreadKey.length - 1) {
      continue;
    }
    iterationHeads.add(scopedThreadKey.slice(atIndex + 1));
  }

  return {
    classification: "configured_bot_threads",
    iterationCount: iterationHeads.size,
    totalCount: scopedThreadKeys.length,
    totalCountKind: "actionable_thread_instances",
  };
}

export function buildExecutionMetricsRunSummaryArtifact(args: {
  issueNumber: number;
  terminalState: ExecutionMetricsRunSummaryArtifact["terminalState"];
  issueCreatedAt?: string | null;
  startedAt: string;
  prCreatedAt?: string | null;
  prMergedAt?: string | null;
  finishedAt: string;
  blockedReason?: BlockedReason | null;
  failureKind?: FailureKind;
  processedReviewThreadIds?: string[];
}): ExecutionMetricsRunSummaryArtifact {
  const issueCreatedAt = args.issueCreatedAt ?? null;
  const prCreatedAt = args.prCreatedAt ?? null;
  const prMergedAt = args.prMergedAt ?? null;

  return {
    schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
    issueNumber: args.issueNumber,
    terminalState: args.terminalState,
    terminalOutcome: terminalOutcomeForState(args),
    issueCreatedAt,
    startedAt: args.startedAt,
    prCreatedAt,
    prMergedAt,
    finishedAt: args.finishedAt,
    runDurationMs: durationMs(args.startedAt, args.finishedAt) ?? 0,
    issueLeadTimeMs: durationMs(issueCreatedAt, args.finishedAt),
    issueToPrCreatedMs: durationMs(issueCreatedAt, prCreatedAt),
    prOpenDurationMs: durationMs(prCreatedAt, prMergedAt),
    reviewMetrics: buildReviewMetrics(args.processedReviewThreadIds ?? []),
  };
}
