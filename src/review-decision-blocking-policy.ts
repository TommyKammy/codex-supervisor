import type { GitHubPullRequest } from "./core/types";

export type BlockingReviewDecision = "REVIEW_REQUIRED" | "CHANGES_REQUESTED";

function configuredBotReviewDecisionResidue(
  pr: Pick<GitHubPullRequest, "configuredBotTopLevelReviewStrength">,
): boolean {
  return (
    pr.configuredBotTopLevelReviewStrength === "blocking" ||
    pr.configuredBotTopLevelReviewStrength === "nitpick_only"
  );
}

export function verifiedConfiguredBotReviewDecisionResidueSatisfied(args: {
  verifiedCurrentHeadRepairResidue: boolean;
  effectiveConfiguredBotBlockerCount: number;
  effectiveHumanBlockerCount: number;
  pr: Pick<GitHubPullRequest, "reviewDecision" | "configuredBotTopLevelReviewStrength">;
}): boolean {
  return (
    args.pr.reviewDecision === "CHANGES_REQUESTED" &&
    args.verifiedCurrentHeadRepairResidue &&
    args.effectiveConfiguredBotBlockerCount === 0 &&
    args.effectiveHumanBlockerCount === 0 &&
    configuredBotReviewDecisionResidue(args.pr)
  );
}

export function reviewDecisionBlocksCurrentHeadRepairProjection(args: {
  humanReviewBlocksMerge: boolean;
  manualThreadCount: number;
  pr: Pick<GitHubPullRequest, "reviewDecision" | "configuredBotTopLevelReviewStrength">;
}): boolean {
  if (!args.humanReviewBlocksMerge) {
    return false;
  }
  if (args.manualThreadCount > 0 || args.pr.reviewDecision === "REVIEW_REQUIRED") {
    return true;
  }
  return args.pr.reviewDecision === "CHANGES_REQUESTED" && !configuredBotReviewDecisionResidue(args.pr);
}

export function aggregateHumanReviewDecisionBlocker(args: {
  humanReviewBlocksMerge: boolean;
  requiresCodexNoMajor: boolean;
  verifiedCurrentHeadRepairResidue: boolean;
  effectiveConfiguredBotBlockerCount: number;
  effectiveHumanBlockerCount: number;
  pr: Pick<GitHubPullRequest, "reviewDecision" | "configuredBotTopLevelReviewStrength">;
}): BlockingReviewDecision | null {
  if (!args.humanReviewBlocksMerge) {
    return null;
  }
  if (args.pr.reviewDecision === "REVIEW_REQUIRED") {
    return "REVIEW_REQUIRED";
  }
  if (args.pr.reviewDecision !== "CHANGES_REQUESTED") {
    return null;
  }
  if (
    verifiedConfiguredBotReviewDecisionResidueSatisfied({
      verifiedCurrentHeadRepairResidue: args.verifiedCurrentHeadRepairResidue,
      effectiveConfiguredBotBlockerCount: args.effectiveConfiguredBotBlockerCount,
      effectiveHumanBlockerCount: args.effectiveHumanBlockerCount,
      pr: args.pr,
    })
  ) {
    return null;
  }
  if (!args.requiresCodexNoMajor && args.pr.configuredBotTopLevelReviewStrength === "nitpick_only") {
    return null;
  }
  return "CHANGES_REQUESTED";
}
