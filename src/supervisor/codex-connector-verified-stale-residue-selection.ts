import { configuredReviewProviderKinds } from "../core/review-providers";
import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import {
  buildStaleReviewBotRemediation,
  shouldAutoResolveVerifiedStaleReviewResidue,
} from "./stale-review-bot-remediation";
import {
  loadReviewThreadFileContents,
  type RepositoryFileContents,
} from "./review-thread-file-contents";
import { resolveTrackedIssueHostPaths } from "../core/journal";

export function shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): boolean {
  const remediation = buildStaleReviewBotRemediation({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
    repositoryFileContents: args.repositoryFileContents,
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
    !configuredReviewProviderKinds(args.config).includes("codex") ||
    !args.getPullRequestIfExists ||
    !args.getChecks ||
    !args.getUnresolvedReviewThreads
  ) {
    return false;
  }

  try {
    const pr = await args.getPullRequestIfExists(record.pr_number, { purpose: "status" });
    if (!pr) {
      return false;
    }

    const [checks, reviewThreads] = await Promise.all([
      args.getChecks(pr.number),
      args.getUnresolvedReviewThreads(pr.number),
    ]);
    const resolvedPaths = resolveTrackedIssueHostPaths(args.config, record);
    const repositoryFileContents = await loadReviewThreadFileContents({
      defaultBranch: args.config.defaultBranch,
      expectedHeadSha: pr.headRefOid,
      branch: record.branch,
      workspacePath: resolvedPaths.workspace,
      issueJournalRelativePath: args.config.issueJournalRelativePath,
      reviewThreads,
    });

    return shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve({
      config: args.config,
      record,
      pr,
      checks,
      reviewThreads,
      repositoryFileContents,
    });
  } catch {
    return false;
  }
}
