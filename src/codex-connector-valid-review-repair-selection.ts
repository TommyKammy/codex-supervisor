import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";
import { configuredReviewProviderKinds } from "./core/review-providers";
import { manualReviewThreads } from "./review-thread-reporting";
import { buildCodexConnectorStillValidReviewRepairTargets } from "./codex-connector-valid-review-repair";
import { effectiveConfiguredBotReviewThreadsForState } from "./pull-request-state-codex-residue-policy";

function allChecksGreen(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.every((check) => check.bucket === "pass" || check.bucket === "skipping");
}

function prAllowsRepair(pr: Pick<GitHubPullRequest, "state" | "isDraft" | "mergeStateStatus" | "mergeable">): boolean {
  return pr.state === "OPEN" && !pr.isDraft && pr.mergeStateStatus !== "DIRTY" && pr.mergeable !== "CONFLICTING";
}

export function shouldReenterCodexConnectorValidReviewRepair(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repairReviewThreads?: ReviewThread[];
}): boolean {
  const repairReviewThreads = args.repairReviewThreads ??
    effectiveConfiguredBotReviewThreadsForState(args.config, args.record, args.pr, args.checks, args.reviewThreads);
  return (
    args.record.pr_number === args.pr.number &&
    configuredReviewProviderKinds(args.config).includes("codex") &&
    prAllowsRepair(args.pr) &&
    allChecksGreen(args.checks) &&
    (!args.config.humanReviewBlocksMerge || manualReviewThreads(args.config, args.reviewThreads).length === 0) &&
    buildCodexConnectorStillValidReviewRepairTargets({
      record: args.record,
      pr: args.pr,
      reviewThreads: repairReviewThreads,
    }).length > 0
  );
}

export async function shouldSelectCodexConnectorValidReviewRepair(args: {
  config: SupervisorConfig;
  record: IssueRunRecord | undefined;
  getPullRequestIfExists?: (
    prNumber: number,
    options?: { purpose?: "status" | "action" },
  ) => Promise<GitHubPullRequest | null>;
  getChecks?: (prNumber: number) => Promise<PullRequestCheck[]>;
  getUnresolvedReviewThreads?: (prNumber: number) => Promise<ReviewThread[]>;
}): Promise<boolean> {
  const { config, record } = args;
  if (
    !record ||
    record.state !== "blocked" ||
    (record.blocked_reason !== "manual_review" && record.blocked_reason !== "stale_review_bot") ||
    record.pr_number === null ||
    !configuredReviewProviderKinds(config).includes("codex") ||
    !args.getPullRequestIfExists ||
    !args.getChecks ||
    !args.getUnresolvedReviewThreads
  ) {
    return false;
  }

  try {
    const pr = await args.getPullRequestIfExists(record.pr_number, { purpose: "status" });
    if (!pr || pr.headRefName !== record.branch) {
      return false;
    }

    const [checks, reviewThreads] = await Promise.all([
      args.getChecks(pr.number),
      args.getUnresolvedReviewThreads(pr.number),
    ]);
    return shouldReenterCodexConnectorValidReviewRepair({
      config,
      record,
      pr,
      checks,
      reviewThreads,
    });
  } catch {
    return false;
  }
}
