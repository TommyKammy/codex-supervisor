import path from "node:path";
import { type GitHubIssue, type GitHubPullRequest, type IssueRunRecord, type SupervisorConfig } from "../core/types";
import { readJsonIfExists, writeJsonAtomic } from "../core/utils";
import { executionMetricsRunSummaryPath } from "./execution-metrics-run-summary";
import {
  validateExecutionMetricsRunSummary,
  type ExecutionMetricsRunSummaryArtifact,
} from "./execution-metrics-schema";
import { type LocalReviewArtifact } from "../local-review/types";

export const POST_MERGE_AUDIT_ARTIFACT_SCHEMA_VERSION = 1;

export interface PostMergeAuditArtifact {
  schemaVersion: typeof POST_MERGE_AUDIT_ARTIFACT_SCHEMA_VERSION;
  issueNumber: number;
  branch: string;
  capturedAt: string;
  issue: {
    number: number;
    title: string;
    url: string;
    createdAt: string;
    updatedAt: string;
  };
  pullRequest: {
    number: number;
    title: string;
    url: string;
    createdAt: string;
    mergedAt: string;
    headRefName: string;
    headRefOid: string;
  };
  completion: {
    terminalState: "done";
    lastRecoveryReason: string | null;
    lastRecoveryAt: string | null;
  };
  artifacts: {
    executionMetricsSummaryPath: string | null;
    localReviewSummaryPath: string | null;
    localReviewFindingsPath: string | null;
    externalReviewMissesPath: string | null;
  };
  executionMetrics: ExecutionMetricsRunSummaryArtifact | null;
  localReview: {
    summaryPath: string | null;
    findingsPath: string | null;
    runAt: string | null;
    recommendation: "ready" | "changes_requested" | "unknown" | null;
    degraded: boolean;
    findingsCount: number;
    rootCauseCount: number;
    maxSeverity: "none" | "low" | "medium" | "high" | null;
    verifiedFindingsCount: number;
    verifiedMaxSeverity: "none" | "low" | "medium" | "high" | null;
    artifact: LocalReviewArtifact | null;
  } | null;
  failureTaxonomy: {
    latestFailure: {
      category: string | null;
      failureKind: string | null;
      blockedReason: string | null;
      signature: string | null;
      summary: string | null;
      details: string[];
      updatedAt: string | null;
      repeatedCount: number;
    } | null;
    latestRecovery: {
      reason: string | null;
      at: string | null;
      occurrenceCount: number | null;
      timeToLatestRecoveryMs: number | null;
    } | null;
    staleStabilizingNoPrRecoveryCount: number;
  };
}

function safeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function postMergeAuditArtifactDir(
  config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">,
): string {
  return path.join(config.localReviewArtifactDir, safeSlug(config.repoSlug), "post-merge-audits");
}

export function postMergeAuditArtifactPath(args: {
  config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">;
  issueNumber: number;
  headSha: string;
}): string {
  return path.join(
    postMergeAuditArtifactDir(args.config),
    `issue-${args.issueNumber}-head-${args.headSha.slice(0, 12)}.json`,
  );
}

async function loadTypedLocalReviewArtifact(summaryPath: string | null): Promise<{
  findingsPath: string | null;
  artifact: LocalReviewArtifact | null;
}> {
  if (!summaryPath || path.extname(summaryPath) !== ".md") {
    return { findingsPath: null, artifact: null };
  }

  const findingsPath = `${summaryPath.slice(0, -3)}.json`;
  const artifact = await readJsonIfExists<LocalReviewArtifact>(findingsPath);
  return { findingsPath, artifact };
}

function validateExecutionMetricsRunSummarySafely(
  issueNumber: number,
  raw: unknown,
): ExecutionMetricsRunSummaryArtifact | null {
  try {
    return validateExecutionMetricsRunSummary(raw);
  } catch (error) {
    console.warn(`Failed to validate execution metrics run summary for post-merge audit issue #${issueNumber}.`, error);
    return null;
  }
}

async function writePostMergeAuditArtifactSafely(
  issueNumber: number,
  artifactPath: string,
  artifact: PostMergeAuditArtifact,
): Promise<string | null> {
  try {
    await writeJsonAtomic(artifactPath, artifact);
    return artifactPath;
  } catch (error) {
    console.warn(`Failed to write post-merge audit artifact for issue #${issueNumber}.`, error);
    return null;
  }
}

function localReviewSourceRecord(
  previousRecord: Pick<
    IssueRunRecord,
    | "local_review_summary_path"
    | "local_review_run_at"
    | "local_review_recommendation"
    | "local_review_degraded"
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
  >,
  nextRecord: Pick<
    IssueRunRecord,
    | "local_review_summary_path"
    | "local_review_run_at"
    | "local_review_recommendation"
    | "local_review_degraded"
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
  >,
) {
  return previousRecord.local_review_summary_path ? previousRecord : nextRecord;
}

export async function syncPostMergeAuditArtifact(args: {
  config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">;
  previousRecord: Pick<
    IssueRunRecord,
    | "issue_number"
    | "branch"
    | "workspace"
    | "local_review_summary_path"
    | "local_review_run_at"
    | "local_review_recommendation"
    | "local_review_degraded"
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "external_review_misses_path"
    | "last_failure_kind"
    | "last_failure_context"
    | "blocked_reason"
    | "repeated_failure_signature_count"
    | "stale_stabilizing_no_pr_recovery_count"
  >;
  nextRecord: Pick<
    IssueRunRecord,
    | "state"
    | "branch"
    | "workspace"
    | "local_review_summary_path"
    | "local_review_run_at"
    | "local_review_recommendation"
    | "local_review_degraded"
    | "local_review_findings_count"
    | "local_review_root_cause_count"
    | "local_review_max_severity"
    | "local_review_verified_findings_count"
    | "local_review_verified_max_severity"
    | "last_recovery_reason"
    | "last_recovery_at"
    | "updated_at"
  >;
  issue: Pick<GitHubIssue, "number" | "title" | "url" | "createdAt" | "updatedAt">;
  pullRequest: Pick<
    GitHubPullRequest,
    "number" | "title" | "url" | "createdAt" | "mergedAt" | "headRefName" | "headRefOid"
  > | null;
}): Promise<string | null> {
  if (args.nextRecord.state !== "done" || !args.nextRecord.workspace || !args.pullRequest?.mergedAt) {
    return null;
  }

  const executionMetricsSummaryPath = executionMetricsRunSummaryPath(args.nextRecord.workspace);
  const executionMetricsRaw = await readJsonIfExists<ExecutionMetricsRunSummaryArtifact>(executionMetricsSummaryPath);
  const loadedExecutionMetrics = executionMetricsRaw
    ? validateExecutionMetricsRunSummarySafely(args.issue.number, executionMetricsRaw)
    : null;
  const executionMetrics =
    loadedExecutionMetrics &&
    loadedExecutionMetrics.issueNumber === args.issue.number &&
    loadedExecutionMetrics.terminalState === "done" &&
    loadedExecutionMetrics.prMergedAt === args.pullRequest.mergedAt
      ? loadedExecutionMetrics
      : null;

  const localReviewRecord = localReviewSourceRecord(args.previousRecord, args.nextRecord);
  const { findingsPath: localReviewFindingsPath, artifact: localReviewArtifact } = await loadTypedLocalReviewArtifact(
    localReviewRecord.local_review_summary_path,
  );

  const artifact: PostMergeAuditArtifact = {
    schemaVersion: POST_MERGE_AUDIT_ARTIFACT_SCHEMA_VERSION,
    issueNumber: args.issue.number,
    branch: args.nextRecord.branch,
    capturedAt: args.nextRecord.updated_at,
    issue: {
      number: args.issue.number,
      title: args.issue.title,
      url: args.issue.url,
      createdAt: args.issue.createdAt,
      updatedAt: args.issue.updatedAt,
    },
    pullRequest: {
      number: args.pullRequest.number,
      title: args.pullRequest.title,
      url: args.pullRequest.url,
      createdAt: args.pullRequest.createdAt,
      mergedAt: args.pullRequest.mergedAt,
      headRefName: args.pullRequest.headRefName,
      headRefOid: args.pullRequest.headRefOid,
    },
    completion: {
      terminalState: "done",
      lastRecoveryReason: args.nextRecord.last_recovery_reason,
      lastRecoveryAt: args.nextRecord.last_recovery_at,
    },
    artifacts: {
      executionMetricsSummaryPath: executionMetrics ? executionMetricsSummaryPath : null,
      localReviewSummaryPath: localReviewRecord.local_review_summary_path,
      localReviewFindingsPath,
      externalReviewMissesPath: args.previousRecord.external_review_misses_path,
    },
    executionMetrics,
    localReview: localReviewRecord.local_review_summary_path
      ? {
          summaryPath: localReviewRecord.local_review_summary_path,
          findingsPath: localReviewFindingsPath,
          runAt: localReviewRecord.local_review_run_at,
          recommendation: localReviewRecord.local_review_recommendation,
          degraded: localReviewRecord.local_review_degraded,
          findingsCount: localReviewRecord.local_review_findings_count,
          rootCauseCount: localReviewRecord.local_review_root_cause_count,
          maxSeverity: localReviewRecord.local_review_max_severity,
          verifiedFindingsCount: localReviewRecord.local_review_verified_findings_count,
          verifiedMaxSeverity: localReviewRecord.local_review_verified_max_severity,
          artifact: localReviewArtifact,
        }
      : null,
    failureTaxonomy: {
      latestFailure: args.previousRecord.last_failure_context
        ? {
            category: args.previousRecord.last_failure_context.category,
            failureKind: args.previousRecord.last_failure_kind,
            blockedReason: args.previousRecord.blocked_reason,
            signature: args.previousRecord.last_failure_context.signature,
            summary: args.previousRecord.last_failure_context.summary,
            details: [...args.previousRecord.last_failure_context.details],
            updatedAt: args.previousRecord.last_failure_context.updated_at,
            repeatedCount: Math.max(args.previousRecord.repeated_failure_signature_count, 1),
          }
        : executionMetrics?.failureMetrics
          ? {
              category: executionMetrics.failureMetrics.category,
              failureKind: executionMetrics.failureMetrics.failureKind,
              blockedReason: executionMetrics.failureMetrics.blockedReason,
              signature: null,
              summary: null,
              details: [],
              updatedAt: executionMetrics.failureMetrics.lastOccurredAt,
              repeatedCount: executionMetrics.failureMetrics.occurrenceCount,
            }
          : null,
      latestRecovery: {
        reason: args.nextRecord.last_recovery_reason ?? executionMetrics?.recoveryMetrics?.reason ?? null,
        at: args.nextRecord.last_recovery_at ?? executionMetrics?.recoveryMetrics?.lastRecoveredAt ?? null,
        occurrenceCount: executionMetrics?.recoveryMetrics?.occurrenceCount ?? null,
        timeToLatestRecoveryMs: executionMetrics?.recoveryMetrics?.timeToLatestRecoveryMs ?? null,
      },
      staleStabilizingNoPrRecoveryCount: args.previousRecord.stale_stabilizing_no_pr_recovery_count ?? 0,
    },
  };

  const artifactPath = postMergeAuditArtifactPath({
    config: args.config,
    issueNumber: args.issue.number,
    headSha: args.pullRequest.headRefOid,
  });
  return writePostMergeAuditArtifactSafely(args.issue.number, artifactPath, artifact);
}

export async function syncPostMergeAuditArtifactSafely(
  args: Parameters<typeof syncPostMergeAuditArtifact>[0] & {
    warningContext: string;
  },
): Promise<string | null> {
  try {
    return await syncPostMergeAuditArtifact(args);
  } catch (error) {
    console.warn(
      `Failed to persist post-merge audit artifact while ${args.warningContext} issue #${args.previousRecord.issue_number}.`,
      {
        issueNumber: args.previousRecord.issue_number,
        terminalState: args.nextRecord.state,
        updatedAt: args.nextRecord.updated_at,
      },
      error,
    );
    return null;
  }
}
