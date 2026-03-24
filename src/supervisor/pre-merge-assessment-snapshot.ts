import path from "node:path";
import { readJsonIfExists, writeJsonAtomic } from "../core/utils";
import {
  type GitHubIssue,
  type GitHubPullRequest,
  type IssueRunRecord,
  type PullRequestCheck,
  type ReviewThread,
  type SupervisorConfig,
} from "../core/types";
import type { LocalReviewArtifact } from "../local-review";
import { configuredBotReviewThreads, manualReviewThreads, pendingBotReviewThreads } from "../review-thread-reporting";
import { summarizeChecks, mergeConflictDetected } from "./supervisor-status-rendering";
import { localReviewHeadStatus, localReviewIsGating } from "./supervisor-status-summary-helpers";

export interface PreMergeAssessmentSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  issue: Pick<GitHubIssue, "number" | "title" | "url" | "state" | "updatedAt">;
  supervisor: {
    record: Pick<
      IssueRunRecord,
      | "issue_number"
      | "state"
      | "branch"
      | "pr_number"
      | "blocked_reason"
      | "last_error"
      | "last_failure_kind"
      | "last_failure_signature"
      | "last_head_sha"
      | "provider_success_observed_at"
      | "provider_success_head_sha"
      | "merge_readiness_last_evaluated_at"
      | "local_review_head_sha"
      | "local_review_blocker_summary"
      | "local_review_summary_path"
      | "local_review_run_at"
      | "local_review_max_severity"
      | "local_review_findings_count"
      | "local_review_root_cause_count"
      | "local_review_verified_max_severity"
      | "local_review_verified_findings_count"
      | "local_review_recommendation"
      | "local_review_degraded"
      | "updated_at"
    >;
    headMatchesPullRequest: boolean | null;
    localReviewGating: boolean;
    mergeConflictDetected: boolean;
  };
  pullRequest: GitHubPullRequest | null;
  checks: {
    summary: {
      total: number;
      passingCount: number;
      failingCount: number;
      pendingCount: number;
      skippingCount: number;
      cancelledCount: number;
      otherCount: number;
      allPassing: boolean;
      hasPending: boolean;
      hasFailing: boolean;
    };
    items: PullRequestCheck[];
  };
  reviews: {
    summary: {
      reviewDecision: GitHubPullRequest["reviewDecision"] | null;
      unresolvedCount: number;
      manualUnresolvedCount: number;
      configuredBotUnresolvedCount: number;
      pendingConfiguredBotCount: number;
    };
    items: ReviewThread[];
  };
  localReview: {
    summary: {
      artifactPath: string | null;
      available: boolean;
      headStatus: "none" | "current" | "stale" | "unknown";
      gating: boolean;
      blockerSummary: string | null;
      recommendation: IssueRunRecord["local_review_recommendation"];
      findingsCount: number;
      rootCauseCount: number;
      verifiedFindingsCount: number;
      maxSeverity: IssueRunRecord["local_review_max_severity"];
      verifiedMaxSeverity: IssueRunRecord["local_review_verified_max_severity"];
      degraded: boolean;
      finalEvaluationOutcome: LocalReviewArtifact["finalEvaluation"]["outcome"] | null;
    };
    artifact: LocalReviewArtifact | null;
  };
}

function localReviewArtifactPath(summaryPath: string | null): string | null {
  if (!summaryPath) {
    return null;
  }

  const parsed = path.parse(summaryPath);
  return path.join(parsed.dir, `${parsed.name}.json`);
}

async function loadLocalReviewArtifact(record: Pick<IssueRunRecord, "local_review_summary_path">): Promise<{
  artifactPath: string | null;
  artifact: LocalReviewArtifact | null;
}> {
  const artifactPath = localReviewArtifactPath(record.local_review_summary_path);
  if (!artifactPath) {
    return { artifactPath: null, artifact: null };
  }

  return {
    artifactPath,
    artifact: await readJsonIfExists<LocalReviewArtifact>(artifactPath),
  };
}

function summarizeCheckBuckets(checks: PullRequestCheck[]): PreMergeAssessmentSnapshot["checks"]["summary"] {
  const summary = summarizeChecks(checks);
  let passingCount = 0;
  let failingCount = 0;
  let pendingCount = 0;
  let skippingCount = 0;
  let cancelledCount = 0;
  let otherCount = 0;

  for (const check of checks) {
    if (check.bucket === "pass") {
      passingCount += 1;
    } else if (check.bucket === "fail") {
      failingCount += 1;
    } else if (check.bucket === "pending") {
      pendingCount += 1;
    } else if (check.bucket === "skipping") {
      skippingCount += 1;
    } else if (check.bucket === "cancel") {
      cancelledCount += 1;
    } else {
      otherCount += 1;
    }
  }

  return {
    total: checks.length,
    passingCount,
    failingCount,
    pendingCount,
    skippingCount,
    cancelledCount,
    otherCount,
    allPassing: summary.allPassing,
    hasPending: summary.hasPending,
    hasFailing: summary.hasFailing,
  };
}

export function preMergeAssessmentSnapshotPath(workspacePath: string): string {
  return path.join(workspacePath, ".codex-supervisor", "pre-merge", "assessment-snapshot.json");
}

export function buildPreMergeAssessmentSnapshot(args: {
  config: SupervisorConfig;
  capturedAt: string;
  issue: GitHubIssue;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  localReviewArtifactPath: string | null;
  localReviewArtifact: LocalReviewArtifact | null;
}): PreMergeAssessmentSnapshot {
  const { config, capturedAt, issue, record, pr, checks, reviewThreads, localReviewArtifactPath, localReviewArtifact } = args;
  const manualThreads = manualReviewThreads(config, reviewThreads);
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  const pendingConfiguredThreads = pr ? pendingBotReviewThreads(config, record, pr, reviewThreads) : [];
  const localReviewGating = localReviewIsGating(config, record, pr);

  return {
    schemaVersion: 1,
    capturedAt,
    issue: {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: issue.state,
      updatedAt: issue.updatedAt,
    },
    supervisor: {
      record: {
        issue_number: record.issue_number,
        state: record.state,
        branch: record.branch,
        pr_number: record.pr_number,
        blocked_reason: record.blocked_reason,
        last_error: record.last_error,
        last_failure_kind: record.last_failure_kind,
        last_failure_signature: record.last_failure_signature,
        last_head_sha: record.last_head_sha,
        provider_success_observed_at: record.provider_success_observed_at ?? null,
        provider_success_head_sha: record.provider_success_head_sha ?? null,
        merge_readiness_last_evaluated_at: record.merge_readiness_last_evaluated_at ?? null,
        local_review_head_sha: record.local_review_head_sha,
        local_review_blocker_summary: record.local_review_blocker_summary,
        local_review_summary_path: record.local_review_summary_path,
        local_review_run_at: record.local_review_run_at,
        local_review_max_severity: record.local_review_max_severity,
        local_review_findings_count: record.local_review_findings_count,
        local_review_root_cause_count: record.local_review_root_cause_count,
        local_review_verified_max_severity: record.local_review_verified_max_severity,
        local_review_verified_findings_count: record.local_review_verified_findings_count,
        local_review_recommendation: record.local_review_recommendation,
        local_review_degraded: record.local_review_degraded,
        updated_at: record.updated_at,
      },
      headMatchesPullRequest: pr ? record.last_head_sha === pr.headRefOid : null,
      localReviewGating,
      mergeConflictDetected: pr ? mergeConflictDetected(pr) : false,
    },
    pullRequest: pr,
    checks: {
      summary: summarizeCheckBuckets(checks),
      items: checks,
    },
    reviews: {
      summary: {
        reviewDecision: pr?.reviewDecision ?? null,
        unresolvedCount: reviewThreads.length,
        manualUnresolvedCount: manualThreads.length,
        configuredBotUnresolvedCount: configuredThreads.length,
        pendingConfiguredBotCount: pendingConfiguredThreads.length,
      },
      items: reviewThreads,
    },
    localReview: {
      summary: {
        artifactPath: localReviewArtifactPath,
        available: localReviewArtifact !== null,
        headStatus: localReviewHeadStatus(record, pr),
        gating: localReviewGating,
        blockerSummary: record.local_review_blocker_summary,
        recommendation: record.local_review_recommendation,
        findingsCount: record.local_review_findings_count,
        rootCauseCount: record.local_review_root_cause_count,
        verifiedFindingsCount: record.local_review_verified_findings_count,
        maxSeverity: record.local_review_max_severity,
        verifiedMaxSeverity: record.local_review_verified_max_severity,
        degraded: record.local_review_degraded,
        finalEvaluationOutcome: localReviewArtifact?.finalEvaluation.outcome ?? null,
      },
      artifact: localReviewArtifact,
    },
  };
}

export async function writePreMergeAssessmentSnapshot(args: {
  config: SupervisorConfig;
  capturedAt: string;
  issue: GitHubIssue;
  record: IssueRunRecord;
  workspacePath: string;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): Promise<string> {
  const localReview = await loadLocalReviewArtifact(args.record);
  const snapshot = buildPreMergeAssessmentSnapshot({
    ...args,
    localReviewArtifactPath: localReview.artifactPath,
    localReviewArtifact: localReview.artifact,
  });
  const artifactPath = preMergeAssessmentSnapshotPath(args.workspacePath);
  await writeJsonAtomic(artifactPath, snapshot);
  return artifactPath;
}
