import fs from "node:fs/promises";
import path from "node:path";
import { nowIso, readJsonIfExists, writeJsonAtomic } from "../core/utils";
import {
  type ExecutionMetricsFailureMetrics,
  type ExecutionMetricsRunSummaryArtifact,
  validateExecutionMetricsRunSummary,
} from "./execution-metrics-schema";
import { executionMetricsRetentionRootPath } from "./execution-metrics-run-summary";

export const EXECUTION_METRICS_DAILY_ROLLUPS_SCHEMA_VERSION = 1;

interface ExecutionMetricsAggregateValue {
  average: number | null;
  total: number;
  count: number;
}

interface ExecutionMetricsDailyTerminalStates {
  done: number;
  blocked: number;
  failed: number;
}

interface ExecutionMetricsDailyFailurePattern {
  category: ExecutionMetricsFailureMetrics["category"];
  failureKind: ExecutionMetricsFailureMetrics["failureKind"];
  blockedReason: ExecutionMetricsFailureMetrics["blockedReason"];
  count: number;
}

interface ExecutionMetricsDailyRollup {
  day: string;
  runCount: number;
  terminalStates: ExecutionMetricsDailyTerminalStates;
  leadTimeMs: ExecutionMetricsAggregateValue;
  reviewIterations: ExecutionMetricsAggregateValue;
  reviewThreadInstances: ExecutionMetricsAggregateValue;
  failurePatterns: ExecutionMetricsDailyFailurePattern[];
}

export interface ExecutionMetricsDailyRollupsArtifact {
  schemaVersion: typeof EXECUTION_METRICS_DAILY_ROLLUPS_SCHEMA_VERSION;
  generatedAt: string;
  days: ExecutionMetricsDailyRollup[];
}

export function executionMetricsDailyRollupsPath(retentionRootPath: string): string {
  return path.join(retentionRootPath, "daily-rollups.json");
}

export async function listRetainedExecutionMetricsRunSummaryPaths(retentionRootPath: string): Promise<string[]> {
  const summariesRoot = path.join(retentionRootPath, "run-summaries");
  let entries: string[];
  try {
    entries = await fs.readdir(summariesRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.join(summariesRoot, entry));
}

interface ExecutionMetricsDailyRollupInput {
  summaryPath: string;
  summary: ExecutionMetricsRunSummaryArtifact;
}

interface ExecutionMetricsAggregateAccumulator {
  total: number;
  count: number;
}

interface ExecutionMetricsDailyRollupAccumulator {
  day: string;
  runCount: number;
  terminalStates: ExecutionMetricsDailyTerminalStates;
  leadTimeMs: ExecutionMetricsAggregateAccumulator;
  reviewIterations: ExecutionMetricsAggregateAccumulator;
  reviewThreadInstances: ExecutionMetricsAggregateAccumulator;
  failurePatterns: Map<string, ExecutionMetricsDailyFailurePattern>;
}

function aggregateValue(accumulator: ExecutionMetricsAggregateAccumulator): ExecutionMetricsAggregateValue {
  return {
    average: accumulator.count === 0 ? null : accumulator.total / accumulator.count,
    total: accumulator.total,
    count: accumulator.count,
  };
}

function addNullableMetric(accumulator: ExecutionMetricsAggregateAccumulator, value: number | null): void {
  if (value === null) {
    return;
  }

  accumulator.total += value;
  accumulator.count += 1;
}

function ensureDayAccumulator(
  accumulators: Map<string, ExecutionMetricsDailyRollupAccumulator>,
  day: string,
): ExecutionMetricsDailyRollupAccumulator {
  const existing = accumulators.get(day);
  if (existing) {
    return existing;
  }

  const created: ExecutionMetricsDailyRollupAccumulator = {
    day,
    runCount: 0,
    terminalStates: {
      done: 0,
      blocked: 0,
      failed: 0,
    },
    leadTimeMs: {
      total: 0,
      count: 0,
    },
    reviewIterations: {
      total: 0,
      count: 0,
    },
    reviewThreadInstances: {
      total: 0,
      count: 0,
    },
    failurePatterns: new Map(),
  };
  accumulators.set(day, created);
  return created;
}

function failurePatternKey(failureMetrics: ExecutionMetricsFailureMetrics): string {
  return [
    failureMetrics.category,
    failureMetrics.failureKind ?? "none",
    failureMetrics.blockedReason ?? "none",
  ].join("|");
}

function addFailurePattern(
  accumulator: ExecutionMetricsDailyRollupAccumulator,
  failureMetrics: ExecutionMetricsFailureMetrics | null,
): void {
  if (failureMetrics === null) {
    return;
  }

  const occurrenceCount = failureMetrics.occurrenceCount ?? 1;
  const key = failurePatternKey(failureMetrics);
  const existing = accumulator.failurePatterns.get(key);
  if (existing) {
    existing.count += occurrenceCount;
    return;
  }

  accumulator.failurePatterns.set(key, {
    category: failureMetrics.category,
    failureKind: failureMetrics.failureKind,
    blockedReason: failureMetrics.blockedReason,
    count: occurrenceCount,
  });
}

export function buildExecutionMetricsDailyRollupsArtifact(args: {
  generatedAt?: string;
  runSummaries: ExecutionMetricsDailyRollupInput[];
}): ExecutionMetricsDailyRollupsArtifact {
  const accumulators = new Map<string, ExecutionMetricsDailyRollupAccumulator>();

  for (const entry of args.runSummaries) {
    const summary = validateExecutionMetricsRunSummary(entry.summary);
    const day = summary.finishedAt.slice(0, 10);
    const accumulator = ensureDayAccumulator(accumulators, day);

    accumulator.runCount += 1;
    accumulator.terminalStates[summary.terminalState] += 1;
    addNullableMetric(accumulator.leadTimeMs, summary.issueLeadTimeMs);
    addNullableMetric(accumulator.reviewIterations, summary.reviewMetrics?.iterationCount ?? null);
    addNullableMetric(accumulator.reviewThreadInstances, summary.reviewMetrics?.totalCount ?? null);
    addFailurePattern(accumulator, summary.failureMetrics);
  }

  return {
    schemaVersion: EXECUTION_METRICS_DAILY_ROLLUPS_SCHEMA_VERSION,
    generatedAt: args.generatedAt ?? nowIso(),
    days: Array.from(accumulators.values())
      .sort((left, right) => left.day.localeCompare(right.day))
      .map((accumulator) => ({
        day: accumulator.day,
        runCount: accumulator.runCount,
        terminalStates: accumulator.terminalStates,
        leadTimeMs: aggregateValue(accumulator.leadTimeMs),
        reviewIterations: aggregateValue(accumulator.reviewIterations),
        reviewThreadInstances: aggregateValue(accumulator.reviewThreadInstances),
        failurePatterns: Array.from(accumulator.failurePatterns.values()).sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }
          if (left.category !== right.category) {
            return left.category.localeCompare(right.category);
          }
          if ((left.failureKind ?? "") !== (right.failureKind ?? "")) {
            return (left.failureKind ?? "").localeCompare(right.failureKind ?? "");
          }
          return (left.blockedReason ?? "").localeCompare(right.blockedReason ?? "");
        }),
      })),
  };
}

async function loadRunSummary(summaryPath: string): Promise<ExecutionMetricsDailyRollupInput> {
  const raw = await readJsonIfExists<ExecutionMetricsRunSummaryArtifact>(summaryPath);
  if (raw === null) {
    throw new Error(`Execution metrics run summary not found: ${summaryPath}`);
  }

  return {
    summaryPath,
    summary: validateExecutionMetricsRunSummary(raw),
  };
}

export async function syncExecutionMetricsDailyRollups(args: {
  outputPath: string;
  runSummaryPaths: string[];
  generatedAt?: string;
}): Promise<{ artifactPath: string }> {
  const runSummaries = await Promise.all(args.runSummaryPaths.map((summaryPath) => loadRunSummary(summaryPath)));
  const artifact = buildExecutionMetricsDailyRollupsArtifact({
    generatedAt: args.generatedAt,
    runSummaries,
  });
  await writeJsonAtomic(args.outputPath, artifact);
  return { artifactPath: args.outputPath };
}

export async function syncRetainedExecutionMetricsDailyRollups(args: {
  stateFilePath: string;
  generatedAt?: string;
}): Promise<{ artifactPath: string; runSummaryCount: number }> {
  const retentionRootPath = executionMetricsRetentionRootPath(args.stateFilePath);
  const runSummaryPaths = await listRetainedExecutionMetricsRunSummaryPaths(retentionRootPath);
  const context = await syncExecutionMetricsDailyRollups({
    outputPath: executionMetricsDailyRollupsPath(retentionRootPath),
    runSummaryPaths,
    generatedAt: args.generatedAt,
  });
  return {
    artifactPath: context.artifactPath,
    runSummaryCount: runSummaryPaths.length,
  };
}
