import type { GitHubPullRequest, IssueRunRecord } from "./core/types";

export function hasFreshTrackedPrReadyPromotionBlockerEvidence(
  record: Pick<
    IssueRunRecord,
    | "latest_local_ci_result"
    | "last_host_local_pr_blocker_comment_head_sha"
    | "last_host_local_pr_blocker_comment_signature"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  if (
    record.latest_local_ci_result?.outcome === "failed" &&
    record.latest_local_ci_result.head_sha === pr.headRefOid
  ) {
    return true;
  }

  return (
    record.last_host_local_pr_blocker_comment_head_sha === pr.headRefOid &&
    typeof record.last_host_local_pr_blocker_comment_signature === "string" &&
    record.last_host_local_pr_blocker_comment_signature.length > 0 &&
    !record.last_host_local_pr_blocker_comment_signature.startsWith("cleared:")
  );
}
