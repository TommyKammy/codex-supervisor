import path from "node:path";
import type { GitHubIssue, GitHubPullRequest, IssueRunRecord } from "../core/types";
import { isTerminalState, writeJsonAtomic } from "../core/utils";
import {
  type ExecutionMetricsRunSummaryArtifact,
  validateExecutionMetricsRunSummary,
} from "./execution-metrics-schema";
import { buildExecutionMetricsRunSummaryArtifact } from "./execution-metrics-lifecycle";

export function executionMetricsRunSummaryPath(workspacePath: string): string {
  return path.join(workspacePath, ".codex-supervisor", "execution-metrics", "run-summary.json");
}

export async function syncExecutionMetricsRunSummary(args: {
  previousRecord: Pick<IssueRunRecord, "issue_number" | "updated_at">;
  nextRecord: Pick<IssueRunRecord, "state" | "workspace" | "updated_at" | "blocked_reason" | "last_failure_kind">;
  issue?: Pick<GitHubIssue, "createdAt"> | null;
  pullRequest?: Pick<GitHubPullRequest, "createdAt" | "mergedAt"> | null;
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

  const artifact: ExecutionMetricsRunSummaryArtifact = buildExecutionMetricsRunSummaryArtifact({
    issueNumber: args.previousRecord.issue_number,
    terminalState,
    issueCreatedAt: args.issue?.createdAt ?? null,
    startedAt: args.previousRecord.updated_at,
    prCreatedAt: args.pullRequest?.createdAt ?? null,
    prMergedAt: args.pullRequest?.mergedAt ?? null,
    finishedAt: args.nextRecord.updated_at,
    blockedReason: args.nextRecord.blocked_reason,
    failureKind: args.nextRecord.last_failure_kind,
  });

  const artifactPath = executionMetricsRunSummaryPath(args.nextRecord.workspace);
  await writeJsonAtomic(artifactPath, validateExecutionMetricsRunSummary(artifact));
  return artifactPath;
}
