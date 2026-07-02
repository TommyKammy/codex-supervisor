import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";
import {
  buildStaleReviewBotRemediation,
  shouldAutoResolveVerifiedStaleReviewResidue,
} from "./supervisor/stale-review-bot-remediation";

export function shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  const remediation = buildStaleReviewBotRemediation({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
  });

  return shouldAutoResolveVerifiedStaleReviewResidue({
    ...args,
    remediation,
  });
}

export async function shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve(args: {
  config: SupervisorConfig;
  record: IssueRunRecord | undefined;
  getPullRequestIfExists?: (
    prNumber: number,
    options?: { purpose?: "status" | "action" },
  ) => Promise<GitHubPullRequest | null>;
  getChecks?: (prNumber: number) => Promise<PullRequestCheck[]>;
  getUnresolvedReviewThreads?: (prNumber: number) => Promise<ReviewThread[]>;
}): Promise<boolean> {
  const { record } = args;
  if (
    !record ||
    record.state !== "blocked" ||
    (record.blocked_reason !== "manual_review" && record.blocked_reason !== "stale_review_bot") ||
    record.pr_number === null ||
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

    return shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve({
      config: args.config,
      record,
      pr,
      checks,
      reviewThreads,
    });
  } catch {
    return false;
  }
}
