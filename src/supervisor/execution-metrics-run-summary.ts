import path from "node:path";
import type { IssueRunRecord } from "../core/types";
import { isTerminalState, writeJsonAtomic } from "../core/utils";
import {
  EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
  type ExecutionMetricsRunSummaryArtifact,
  validateExecutionMetricsRunSummary,
} from "./execution-metrics-schema";

export function executionMetricsRunSummaryPath(workspacePath: string): string {
  return path.join(workspacePath, ".codex-supervisor", "execution-metrics", "run-summary.json");
}

export async function syncExecutionMetricsRunSummary(args: {
  previousRecord: Pick<IssueRunRecord, "issue_number" | "updated_at">;
  nextRecord: Pick<IssueRunRecord, "state" | "workspace" | "updated_at">;
}): Promise<string | null> {
  const { state } = args.nextRecord;
  if (!isTerminalState(state) || !args.nextRecord.workspace) {
    return null;
  }
  const terminalState: ExecutionMetricsRunSummaryArtifact["terminalState"] =
    state === "done" || state === "blocked" || state === "failed"
      ? state
      : (() => {
          throw new Error(`Unexpected non-terminal state: ${state}`);
        })();

  const artifact: ExecutionMetricsRunSummaryArtifact = {
    schemaVersion: EXECUTION_METRICS_RUN_SUMMARY_SCHEMA_VERSION,
    issueNumber: args.previousRecord.issue_number,
    terminalState,
    startedAt: args.previousRecord.updated_at,
    finishedAt: args.nextRecord.updated_at,
  };

  const artifactPath = executionMetricsRunSummaryPath(args.nextRecord.workspace);
  await writeJsonAtomic(artifactPath, validateExecutionMetricsRunSummary(artifact));
  return artifactPath;
}
