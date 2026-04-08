import path from "node:path";
import { localReviewBlocksMerge, localReviewBlocksReady } from "../review-handling";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, SupervisorConfig } from "../core/types";

export function summarizeCheckBuckets(checks: PullRequestCheck[]): string {
  if (checks.length === 0) {
    return "none";
  }

  const counts = {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
    other: 0,
  };

  for (const check of checks) {
    if (check.bucket === "pass") {
      counts.pass += 1;
    } else if (check.bucket === "fail") {
      counts.fail += 1;
    } else if (check.bucket === "pending") {
      counts.pending += 1;
    } else if (check.bucket === "skipping") {
      counts.skipping += 1;
    } else if (check.bucket === "cancel") {
      counts.cancel += 1;
    } else {
      counts.other += 1;
    }
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(" ");
}

export function listChecksByBucket(checks: PullRequestCheck[], bucket: "fail" | "pending"): string | null {
  const matches = checks.filter((check) => check.bucket === bucket).map((check) => check.name);
  return matches.length > 0 ? matches.join(", ") : null;
}

export function formatRecentRecord(record: IssueRunRecord | null): string {
  if (!record) {
    return "none";
  }

  return `#${record.issue_number} state=${record.state} updated_at=${record.updated_at}`;
}

export function localReviewHeadStatus(
  record: Pick<IssueRunRecord, "local_review_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
): "none" | "current" | "stale" | "unknown" {
  if (!record.local_review_head_sha) {
    return "none";
  }

  if (!pr) {
    return "unknown";
  }

  return record.local_review_head_sha === pr.headRefOid ? "current" : "stale";
}

export function localReviewHeadDetails(
  record: Pick<IssueRunRecord, "local_review_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
): {
  status: "none" | "current" | "stale" | "unknown";
  reviewedHeadSha: string;
  prHeadSha: string;
  driftSuffix: string;
} {
  const status = localReviewHeadStatus(record, pr);
  const reviewedHeadSha = record.local_review_head_sha ?? "none";
  const prHeadSha = pr?.headRefOid ?? "unknown";

  return {
    status,
    reviewedHeadSha,
    prHeadSha,
    driftSuffix: status === "stale" ? ` needs_review_run=yes drift=${reviewedHeadSha}->${prHeadSha}` : "",
  };
}

export function localReviewIsGating(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation"> &
    Partial<
      Pick<
        IssueRunRecord,
        "local_review_degraded" | "pre_merge_evaluation_outcome" | "pre_merge_manual_review_count" | "pre_merge_follow_up_count"
      >
    >,
  pr: GitHubPullRequest | null,
): boolean {
  if (!pr) {
    return false;
  }

  return localReviewBlocksReady(config, record, pr) || localReviewBlocksMerge(config, record, pr);
}

export function displayRelativeArtifactPath(config: SupervisorConfig, filePath: string): string {
  const relativePath = path.relative(config.localReviewArtifactDir, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath
    : path.basename(filePath);
}
