import type { BlockedReason, FailureContext, FailureKind } from "../core/types";
import type { RecoveryEvent } from "../run-once-cycle-prelude";
import {
  EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
  type ExecutionMetricsFailureMetrics,
  type ExecutionMetricsRecoveryMetrics,
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

function latestTimestamp(...timestamps: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const timestamp of timestamps) {
    if (!timestamp) {
      continue;
    }
    const parsed = Date.parse(timestamp);
    if (parsed > latestMs) {
      latest = timestamp;
      latestMs = parsed;
    }
  }

  return latest;
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

function buildFailureMetrics(args: {
  failureContext?: FailureContext | null;
  failureKind?: FailureKind;
  blockedReason?: BlockedReason | null;
  repeatedFailureSignatureCount?: number;
}): ExecutionMetricsFailureMetrics | null {
  if (!args.failureContext?.category) {
    return null;
  }

  return {
    classification: "latest_failure",
    category: args.failureContext.category,
    failureKind: args.failureKind ?? null,
    blockedReason: args.blockedReason ?? null,
    occurrenceCount: Math.max(args.repeatedFailureSignatureCount ?? 0, 1),
    lastOccurredAt: args.failureContext.updated_at,
  };
}

function parseRecoveryReasonCategory(reason: string): string {
  const separatorIndex = reason.indexOf(":");
  return (separatorIndex >= 0 ? reason.slice(0, separatorIndex) : reason).trim();
}

function buildRecoveryMetrics(args: {
  issueNumber: number;
  failureMetrics: ExecutionMetricsFailureMetrics | null;
  recoveryEvents?: RecoveryEvent[];
  lastRecoveryReason?: string | null;
  lastRecoveryAt?: string | null;
  staleStabilizingNoPrRecoveryCount?: number;
}): ExecutionMetricsRecoveryMetrics | null {
  const issueRecoveryEvents = (args.recoveryEvents ?? []).filter((event) => event.issueNumber === args.issueNumber);
  const latestRecoveryEvent = issueRecoveryEvents.reduce<RecoveryEvent | null>(
    (latest, event) => latest === null || Date.parse(event.at) > Date.parse(latest.at) ? event : latest,
    null,
  );
  const lastRecoveredAt = latestRecoveryEvent?.at ?? args.lastRecoveryAt ?? null;
  const latestRecoveryReason = latestRecoveryEvent?.reason ?? args.lastRecoveryReason ?? null;

  if (!lastRecoveredAt || !latestRecoveryReason) {
    return null;
  }

  const derivedRecoveryDelay =
    args.failureMetrics === null
      ? null
      : Date.parse(lastRecoveredAt) < Date.parse(args.failureMetrics.lastOccurredAt)
        ? null
        : durationMs(args.failureMetrics.lastOccurredAt, lastRecoveredAt);
  return {
    classification: "latest_recovery",
    reason: parseRecoveryReasonCategory(latestRecoveryReason),
    occurrenceCount: Math.max(
      issueRecoveryEvents.length,
      args.staleStabilizingNoPrRecoveryCount ?? 0,
      1,
    ),
    lastRecoveredAt,
    timeToLatestRecoveryMs: derivedRecoveryDelay,
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
  failureContext?: FailureContext | null;
  repeatedFailureSignatureCount?: number;
  processedReviewThreadIds?: string[];
  recoveryEvents?: RecoveryEvent[];
  lastRecoveryReason?: string | null;
  lastRecoveryAt?: string | null;
  staleStabilizingNoPrRecoveryCount?: number;
}): ExecutionMetricsRunSummaryArtifact {
  const issueCreatedAt = args.issueCreatedAt ?? null;
  const prCreatedAt = args.prCreatedAt ?? null;
  const prMergedAt = args.prMergedAt ?? null;
  const failureMetrics = buildFailureMetrics({
    failureContext: args.failureContext,
    failureKind: args.failureKind,
    blockedReason: args.blockedReason,
    repeatedFailureSignatureCount: args.repeatedFailureSignatureCount,
  });
  const recoveryMetrics = buildRecoveryMetrics({
    issueNumber: args.issueNumber,
    failureMetrics,
    recoveryEvents: args.recoveryEvents,
    lastRecoveryReason: args.lastRecoveryReason,
    lastRecoveryAt: args.lastRecoveryAt,
    staleStabilizingNoPrRecoveryCount: args.staleStabilizingNoPrRecoveryCount,
  });
  const finishedAt = latestTimestamp(
    args.finishedAt,
    failureMetrics?.lastOccurredAt,
    recoveryMetrics?.lastRecoveredAt,
  ) ?? args.finishedAt;

  return {
    schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
    issueNumber: args.issueNumber,
    terminalState: args.terminalState,
    terminalOutcome: terminalOutcomeForState(args),
    issueCreatedAt,
    startedAt: args.startedAt,
    prCreatedAt,
    prMergedAt,
    finishedAt,
    runDurationMs: durationMs(args.startedAt, finishedAt) ?? 0,
    issueLeadTimeMs: durationMs(issueCreatedAt, finishedAt),
    issueToPrCreatedMs: durationMs(issueCreatedAt, prCreatedAt),
    prOpenDurationMs: durationMs(prCreatedAt, prMergedAt),
    reviewMetrics: buildReviewMetrics(args.processedReviewThreadIds ?? []),
    failureMetrics,
    recoveryMetrics,
  };
}
