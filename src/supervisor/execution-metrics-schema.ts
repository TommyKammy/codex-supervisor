import type { BlockedReason, FailureContextCategory, FailureKind } from "../core/types";

export const EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION = 4;
export const EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "issueNumber",
  "terminalState",
  "terminalOutcome",
  "issueCreatedAt",
  "startedAt",
  "prCreatedAt",
  "prMergedAt",
  "finishedAt",
  "runDurationMs",
  "issueLeadTimeMs",
  "issueToPrCreatedMs",
  "prOpenDurationMs",
  "reviewMetrics",
  "failureMetrics",
  "recoveryMetrics",
] as const;
const TERMINAL_STATES = ["done", "blocked", "failed"] as const;
const TERMINAL_OUTCOME_CATEGORIES = ["completed", "blocked", "failed"] as const;
const REVIEW_METRICS_CLASSIFICATIONS = ["configured_bot_threads"] as const;
const REVIEW_METRICS_TOTAL_COUNT_KINDS = ["actionable_thread_instances"] as const;
const FAILURE_METRICS_CLASSIFICATIONS = ["latest_failure"] as const;
const FAILURE_METRICS_CATEGORIES = ["checks", "review", "conflict", "codex", "manual", "blocked"] as const;
const FAILURE_METRICS_KINDS = ["timeout", "command_error", "codex_exit", "codex_failed"] as const;
const FAILURE_METRICS_BLOCKED_REASONS = [
  "requirements",
  "clarification",
  "permissions",
  "secrets",
  "verification",
  "review_bot_timeout",
  "copilot_timeout",
  "stale_review_bot",
  "manual_review",
  "manual_pr_closed",
  "handoff_missing",
  "unknown",
] as const;
const RECOVERY_METRICS_CLASSIFICATIONS = ["latest_recovery"] as const;

export interface ExecutionMetricsTerminalOutcome {
  category: (typeof TERMINAL_OUTCOME_CATEGORIES)[number];
  reason: string | null;
}

export interface ExecutionMetricsReviewMetrics {
  classification: (typeof REVIEW_METRICS_CLASSIFICATIONS)[number];
  iterationCount: number;
  totalCount: number;
  totalCountKind: (typeof REVIEW_METRICS_TOTAL_COUNT_KINDS)[number];
}

export interface ExecutionMetricsFailureMetrics {
  classification: (typeof FAILURE_METRICS_CLASSIFICATIONS)[number];
  category: Exclude<FailureContextCategory, null>;
  failureKind: Exclude<FailureKind, null> | null;
  blockedReason: Exclude<BlockedReason, null> | null;
  occurrenceCount: number;
  lastOccurredAt: string;
}

export interface ExecutionMetricsRecoveryMetrics {
  classification: (typeof RECOVERY_METRICS_CLASSIFICATIONS)[number];
  reason: string;
  occurrenceCount: number;
  lastRecoveredAt: string;
  timeToLatestRecoveryMs: number | null;
}

export interface ExecutionMetricsRunSummaryArtifact {
  schemaVersion: typeof EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION;
  issueNumber: number;
  terminalState: (typeof TERMINAL_STATES)[number];
  terminalOutcome: ExecutionMetricsTerminalOutcome;
  issueCreatedAt: string | null;
  startedAt: string;
  prCreatedAt: string | null;
  prMergedAt: string | null;
  finishedAt: string;
  runDurationMs: number;
  issueLeadTimeMs: number | null;
  issueToPrCreatedMs: number | null;
  prOpenDurationMs: number | null;
  reviewMetrics: ExecutionMetricsReviewMetrics | null;
  failureMetrics: ExecutionMetricsFailureMetrics | null;
  recoveryMetrics: ExecutionMetricsRecoveryMetrics | null;
}

function failValidation(message: string): never {
  throw new Error(`Invalid execution metrics run summary: ${message}`);
}

function formatKeyList(keys: readonly string[]): string {
  if (keys.length <= 1) {
    return keys.join("");
  }

  return `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`;
}

function expectObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failValidation("summary must be an object.");
  }

  return value as Record<string, unknown>;
}

function expectExactTopLevelKeys(value: Record<string, unknown>): void {
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS.length ||
    EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS.some((key) => !actualKeys.includes(key))
  ) {
    failValidation(`summary must contain ${formatKeyList(EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS)}.`);
  }
}

function expectNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    failValidation(`${field} must be a non-negative integer.`);
  }

  return value as number;
}

function expectIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) {
    failValidation(`${field} must be an ISO-8601 timestamp.`);
  }

  return value;
}

function expectNullableIsoTimestamp(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return expectIsoTimestamp(value, field);
}

function expectTerminalState(value: unknown): ExecutionMetricsRunSummaryArtifact["terminalState"] {
  if (typeof value !== "string" || !TERMINAL_STATES.includes(value as ExecutionMetricsRunSummaryArtifact["terminalState"])) {
    failValidation(`terminalState must be one of: ${TERMINAL_STATES.join(", ")}.`);
  }

  return value as ExecutionMetricsRunSummaryArtifact["terminalState"];
}

function expectTerminalOutcome(value: unknown): ExecutionMetricsTerminalOutcome {
  const outcome = expectObject(value);
  const keys = Object.keys(outcome);
  if (keys.length !== 2 || !keys.includes("category") || !keys.includes("reason")) {
    failValidation("terminalOutcome must contain category and reason.");
  }
  if (
    typeof outcome.category !== "string" ||
    !TERMINAL_OUTCOME_CATEGORIES.includes(outcome.category as ExecutionMetricsTerminalOutcome["category"])
  ) {
    failValidation(`terminalOutcome.category must be one of: ${TERMINAL_OUTCOME_CATEGORIES.join(", ")}.`);
  }
  if (outcome.reason !== null && typeof outcome.reason !== "string") {
    failValidation("terminalOutcome.reason must be a string or null.");
  }

  return {
    category: outcome.category as ExecutionMetricsTerminalOutcome["category"],
    reason: outcome.reason as string | null,
  };
}

function expectNullableNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }

  return expectNonNegativeInteger(value, field);
}

function expectReviewMetrics(value: unknown): ExecutionMetricsReviewMetrics | null {
  if (value === null) {
    return null;
  }

  const reviewMetrics = expectObject(value);
  const keys = Object.keys(reviewMetrics);
  if (
    keys.length !== 4 ||
    !keys.includes("classification") ||
    !keys.includes("iterationCount") ||
    !keys.includes("totalCount") ||
    !keys.includes("totalCountKind")
  ) {
    failValidation(
      "reviewMetrics must contain classification, iterationCount, totalCount, and totalCountKind.",
    );
  }

  if (
    typeof reviewMetrics.classification !== "string" ||
    !REVIEW_METRICS_CLASSIFICATIONS.includes(
      reviewMetrics.classification as ExecutionMetricsReviewMetrics["classification"],
    )
  ) {
    failValidation(
      `reviewMetrics.classification must be one of: ${REVIEW_METRICS_CLASSIFICATIONS.join(", ")}.`,
    );
  }
  if (
    typeof reviewMetrics.totalCountKind !== "string" ||
    !REVIEW_METRICS_TOTAL_COUNT_KINDS.includes(
      reviewMetrics.totalCountKind as ExecutionMetricsReviewMetrics["totalCountKind"],
    )
  ) {
    failValidation(
      `reviewMetrics.totalCountKind must be one of: ${REVIEW_METRICS_TOTAL_COUNT_KINDS.join(", ")}.`,
    );
  }

  return {
    classification: reviewMetrics.classification as ExecutionMetricsReviewMetrics["classification"],
    iterationCount: expectNonNegativeInteger(reviewMetrics.iterationCount, "reviewMetrics.iterationCount"),
    totalCount: expectNonNegativeInteger(reviewMetrics.totalCount, "reviewMetrics.totalCount"),
    totalCountKind: reviewMetrics.totalCountKind as ExecutionMetricsReviewMetrics["totalCountKind"],
  };
}

function expectFailureMetrics(value: unknown): ExecutionMetricsFailureMetrics | null {
  if (value === null) {
    return null;
  }

  const failureMetrics = expectObject(value);
  const keys = Object.keys(failureMetrics);
  if (
    keys.length !== 6 ||
    !keys.includes("classification") ||
    !keys.includes("category") ||
    !keys.includes("failureKind") ||
    !keys.includes("blockedReason") ||
    !keys.includes("occurrenceCount") ||
    !keys.includes("lastOccurredAt")
  ) {
    failValidation(
      "failureMetrics must contain classification, category, failureKind, blockedReason, occurrenceCount, and lastOccurredAt.",
    );
  }

  if (
    typeof failureMetrics.classification !== "string" ||
    !FAILURE_METRICS_CLASSIFICATIONS.includes(
      failureMetrics.classification as ExecutionMetricsFailureMetrics["classification"],
    )
  ) {
    failValidation(
      `failureMetrics.classification must be one of: ${FAILURE_METRICS_CLASSIFICATIONS.join(", ")}.`,
    );
  }
  if (
    typeof failureMetrics.category !== "string" ||
    !FAILURE_METRICS_CATEGORIES.includes(failureMetrics.category as ExecutionMetricsFailureMetrics["category"])
  ) {
    failValidation(`failureMetrics.category must be one of: ${FAILURE_METRICS_CATEGORIES.join(", ")}.`);
  }
  if (
    failureMetrics.failureKind !== null &&
    (typeof failureMetrics.failureKind !== "string" ||
      !FAILURE_METRICS_KINDS.includes(failureMetrics.failureKind as Exclude<FailureKind, null>))
  ) {
    failValidation(`failureMetrics.failureKind must be one of: ${FAILURE_METRICS_KINDS.join(", ")} or null.`);
  }
  if (
    failureMetrics.blockedReason !== null &&
    (typeof failureMetrics.blockedReason !== "string" ||
      !FAILURE_METRICS_BLOCKED_REASONS.includes(failureMetrics.blockedReason as Exclude<BlockedReason, null>))
  ) {
    failValidation(
      `failureMetrics.blockedReason must be one of: ${FAILURE_METRICS_BLOCKED_REASONS.join(", ")} or null.`,
    );
  }

  return {
    classification: failureMetrics.classification as ExecutionMetricsFailureMetrics["classification"],
    category: failureMetrics.category as ExecutionMetricsFailureMetrics["category"],
    failureKind: failureMetrics.failureKind as ExecutionMetricsFailureMetrics["failureKind"],
    blockedReason: failureMetrics.blockedReason as ExecutionMetricsFailureMetrics["blockedReason"],
    occurrenceCount: expectNonNegativeInteger(failureMetrics.occurrenceCount, "failureMetrics.occurrenceCount"),
    lastOccurredAt: expectIsoTimestamp(failureMetrics.lastOccurredAt, "failureMetrics.lastOccurredAt"),
  };
}

function expectRecoveryMetrics(value: unknown): ExecutionMetricsRecoveryMetrics | null {
  if (value === null) {
    return null;
  }

  const recoveryMetrics = expectObject(value);
  const keys = Object.keys(recoveryMetrics);
  if (
    keys.length !== 5 ||
    !keys.includes("classification") ||
    !keys.includes("reason") ||
    !keys.includes("occurrenceCount") ||
    !keys.includes("lastRecoveredAt") ||
    !keys.includes("timeToLatestRecoveryMs")
  ) {
    failValidation(
      "recoveryMetrics must contain classification, reason, occurrenceCount, lastRecoveredAt, and timeToLatestRecoveryMs.",
    );
  }

  if (
    typeof recoveryMetrics.classification !== "string" ||
    !RECOVERY_METRICS_CLASSIFICATIONS.includes(
      recoveryMetrics.classification as ExecutionMetricsRecoveryMetrics["classification"],
    )
  ) {
    failValidation(
      `recoveryMetrics.classification must be one of: ${RECOVERY_METRICS_CLASSIFICATIONS.join(", ")}.`,
    );
  }
  if (typeof recoveryMetrics.reason !== "string" || recoveryMetrics.reason.trim().length === 0) {
    failValidation("recoveryMetrics.reason must be a non-empty string.");
  }

  return {
    classification: recoveryMetrics.classification as ExecutionMetricsRecoveryMetrics["classification"],
    reason: recoveryMetrics.reason,
    occurrenceCount: expectNonNegativeInteger(recoveryMetrics.occurrenceCount, "recoveryMetrics.occurrenceCount"),
    lastRecoveredAt: expectIsoTimestamp(recoveryMetrics.lastRecoveredAt, "recoveryMetrics.lastRecoveredAt"),
    timeToLatestRecoveryMs: expectNullableNonNegativeInteger(
      recoveryMetrics.timeToLatestRecoveryMs,
      "recoveryMetrics.timeToLatestRecoveryMs",
    ),
  };
}

function expectDerivedDuration(
  value: number | null,
  start: string | null,
  end: string | null,
  field: string,
): number | null {
  if (start === null || end === null) {
    if (value !== null) {
      failValidation(`${field} must be null when its timestamps are absent.`);
    }
    return null;
  }

  if (value === null) {
    failValidation(`${field} must be present when its timestamps exist.`);
  }

  const duration = Date.parse(end) - Date.parse(start);
  if (duration < 0) {
    failValidation(`${field} timestamps must be chronological.`);
  }
  if (value !== duration) {
    failValidation(`${field} must equal the derived duration from its timestamps.`);
  }

  return value;
}

export function validateExecutionMetricsRunSummary(raw: unknown): ExecutionMetricsRunSummaryArtifact {
  const summary = expectObject(raw);
  expectExactTopLevelKeys(summary);
  for (const key of Object.keys(summary)) {
    if (
      !EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS.includes(
        key as (typeof EXECUTION_METRICS_RUN_SUMMARY_TOP_LEVEL_KEYS)[number],
      )
    ) {
      failValidation(`${key} is not allowed.`);
    }
  }

  if (summary.schemaVersion !== EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION) {
    failValidation(`schemaVersion must be ${EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION}.`);
  }

  const issueCreatedAt = expectNullableIsoTimestamp(summary.issueCreatedAt, "issueCreatedAt");
  const startedAt = expectIsoTimestamp(summary.startedAt, "startedAt");
  const prCreatedAt = expectNullableIsoTimestamp(summary.prCreatedAt, "prCreatedAt");
  const prMergedAt = expectNullableIsoTimestamp(summary.prMergedAt, "prMergedAt");
  const finishedAt = expectIsoTimestamp(summary.finishedAt, "finishedAt");
  const runDurationMs = expectNonNegativeInteger(summary.runDurationMs, "runDurationMs");
  const issueLeadTimeMs = expectNullableNonNegativeInteger(summary.issueLeadTimeMs, "issueLeadTimeMs");
  const issueToPrCreatedMs = expectNullableNonNegativeInteger(summary.issueToPrCreatedMs, "issueToPrCreatedMs");
  const prOpenDurationMs = expectNullableNonNegativeInteger(summary.prOpenDurationMs, "prOpenDurationMs");
  const reviewMetrics = expectReviewMetrics(summary.reviewMetrics);
  const failureMetrics = expectFailureMetrics(summary.failureMetrics);
  const recoveryMetrics = expectRecoveryMetrics(summary.recoveryMetrics);

  expectDerivedDuration(runDurationMs, startedAt, finishedAt, "runDurationMs");
  expectDerivedDuration(issueLeadTimeMs, issueCreatedAt, finishedAt, "issueLeadTimeMs");
  expectDerivedDuration(issueToPrCreatedMs, issueCreatedAt, prCreatedAt, "issueToPrCreatedMs");
  expectDerivedDuration(prOpenDurationMs, prCreatedAt, prMergedAt, "prOpenDurationMs");

  if (failureMetrics && Date.parse(failureMetrics.lastOccurredAt) > Date.parse(finishedAt)) {
    failValidation("failureMetrics.lastOccurredAt must not be after finishedAt.");
  }
  if (recoveryMetrics && Date.parse(recoveryMetrics.lastRecoveredAt) > Date.parse(finishedAt)) {
    failValidation("recoveryMetrics.lastRecoveredAt must not be after finishedAt.");
  }
  if (
    recoveryMetrics &&
    failureMetrics &&
    recoveryMetrics.timeToLatestRecoveryMs !== null &&
    recoveryMetrics.timeToLatestRecoveryMs !== Date.parse(recoveryMetrics.lastRecoveredAt) - Date.parse(failureMetrics.lastOccurredAt)
  ) {
    failValidation("recoveryMetrics.timeToLatestRecoveryMs must equal the derived duration from the latest failure to the latest recovery.");
  }
  if (!failureMetrics && recoveryMetrics && recoveryMetrics.timeToLatestRecoveryMs !== null) {
    failValidation("recoveryMetrics.timeToLatestRecoveryMs must be null when failureMetrics is absent.");
  }

  return {
    schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
    issueNumber: expectNonNegativeInteger(summary.issueNumber, "issueNumber"),
    terminalState: expectTerminalState(summary.terminalState),
    terminalOutcome: expectTerminalOutcome(summary.terminalOutcome),
    issueCreatedAt,
    startedAt,
    prCreatedAt,
    prMergedAt,
    finishedAt,
    runDurationMs,
    issueLeadTimeMs,
    issueToPrCreatedMs,
    prOpenDurationMs,
    reviewMetrics,
    failureMetrics,
    recoveryMetrics,
  };
}
