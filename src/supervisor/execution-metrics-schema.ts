export const EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION = 1;
const EXECUTION_METRICS_RUN_SUMMARY_KEYS = [
  "schemaVersion",
  "issueNumber",
  "terminalState",
  "startedAt",
  "finishedAt",
] as const;
const TERMINAL_STATES = ["done", "blocked", "failed"] as const;

export interface ExecutionMetricsRunSummaryArtifact {
  schemaVersion: typeof EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION;
  issueNumber: number;
  terminalState: (typeof TERMINAL_STATES)[number];
  startedAt: string;
  finishedAt: string;
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

function expectTerminalState(value: unknown): ExecutionMetricsRunSummaryArtifact["terminalState"] {
  if (typeof value !== "string" || !TERMINAL_STATES.includes(value as ExecutionMetricsRunSummaryArtifact["terminalState"])) {
    failValidation(`terminalState must be one of: ${TERMINAL_STATES.join(", ")}.`);
  }

  return value as ExecutionMetricsRunSummaryArtifact["terminalState"];
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

  return {
    schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
    issueNumber: expectNonNegativeInteger(summary.issueNumber, "issueNumber"),
    terminalState: expectTerminalState(summary.terminalState),
    startedAt: expectIsoTimestamp(summary.startedAt, "startedAt"),
    finishedAt: expectIsoTimestamp(summary.finishedAt, "finishedAt"),
  };
}
