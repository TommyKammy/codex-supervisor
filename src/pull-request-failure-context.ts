import { FailureContext, GitHubPullRequest, PullRequestCheck } from "./core/types";
import { nowIso } from "./core/utils";

export function buildChecksFailureContext(pr: GitHubPullRequest, checks: PullRequestCheck[]): FailureContext | null {
  const failingChecks = checks.filter((check) => check.bucket === "fail");
  if (failingChecks.length === 0) {
    return null;
  }

  return {
    category: "checks",
    summary: `PR #${pr.number} has failing checks.`,
    signature: failingChecks.map((check) => `${check.name}:${check.bucket}`).join("|"),
    command: "gh pr checks",
    details: failingChecks.map((check) => `${check.name} (${check.bucket}/${check.state}) ${check.link ?? ""}`.trim()),
    url: pr.url,
    updated_at: nowIso(),
  };
}

export function buildConflictFailureContext(pr: GitHubPullRequest): FailureContext {
  return {
    category: "conflict",
    summary: `PR #${pr.number} has merge conflicts and needs a base-branch integration pass.`,
    signature: `dirty:${pr.headRefOid}`,
    command: "git fetch origin && git merge origin/<default-branch>",
    details: [`mergeStateStatus=${pr.mergeStateStatus ?? "unknown"}`],
    url: pr.url,
    updated_at: nowIso(),
  };
}

export function buildCurrentHeadLocalReviewPendingFailureContext(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  record: { local_review_head_sha: string | null };
}): FailureContext {
  const status = args.record.local_review_head_sha === null ? "missing" : "stale";
  const summary =
    status === "missing"
      ? "Current PR head is still waiting for a local review run."
      : "Current PR head is still waiting for a fresh local review run.";
  const signature =
    status === "missing"
      ? `local-review-missing:${args.pr.headRefOid}`
      : `local-review-stale:${args.record.local_review_head_sha}:${args.pr.headRefOid}`;

  return {
    category: "blocked",
    summary,
    signature,
    command: null,
    details: [
      `reviewed_head_sha=${args.record.local_review_head_sha ?? "none"}`,
      `pr_head_sha=${args.pr.headRefOid}`,
      `status=${status}`,
      "summary=awaiting_local_review",
    ],
    url: null,
    updated_at: nowIso(),
  };
}
