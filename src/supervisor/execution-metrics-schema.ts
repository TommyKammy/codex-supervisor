export const EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION = 2;
const EXECUTION_METRICS_RUN_SUMMARY_KEYS = [
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
] as const;
const TERMINAL_STATES = ["done", "blocked", "failed"] as const;
const TERMINAL_OUTCOME_CATEGORIES = ["completed", "blocked", "failed"] as const;

export interface ExecutionMetricsTerminalOutcome {
  category: (typeof TERMINAL_OUTCOME_CATEGORIES)[number];
  reason: string | null;
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
}

function failValidation(message: string): never {
  throw new Error(`Invalid execution metrics run summary: ${message}`);
}

function expectObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failValidation("summary must be an object.");
  }

  return value as Record<string, unknown>;
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
  for (const key of Object.keys(summary)) {
    if (!EXECUTION_METRICS_RUN_SUMMARY_KEYS.includes(key as (typeof EXECUTION_METRICS_RUN_SUMMARY_KEYS)[number])) {
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

  expectDerivedDuration(runDurationMs, startedAt, finishedAt, "runDurationMs");
  expectDerivedDuration(issueLeadTimeMs, issueCreatedAt, finishedAt, "issueLeadTimeMs");
  expectDerivedDuration(issueToPrCreatedMs, issueCreatedAt, prCreatedAt, "issueToPrCreatedMs");
  expectDerivedDuration(prOpenDurationMs, prCreatedAt, prMergedAt, "prOpenDurationMs");

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
  };
}
