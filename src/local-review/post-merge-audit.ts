import {
  type PostMergeAuditOutcome,
  type PostMergeAuditPromotionCandidate,
  type PostMergeAuditRecurringPatternSummary,
  type PostMergeAuditResult,
} from "./types";

function derivePostMergeAuditOutcome(args: {
  recurringPatterns: PostMergeAuditRecurringPatternSummary[];
  promotionCandidates: PostMergeAuditPromotionCandidate[];
}): PostMergeAuditOutcome {
  if (args.promotionCandidates.length > 0) {
    return "promotion_candidates_identified";
  }
  if (args.recurringPatterns.length > 0) {
    return "learning_recorded";
  }

  return "no_action";
}

export function createPostMergeAuditResult(args: {
  recurringPatterns: PostMergeAuditRecurringPatternSummary[];
  promotionCandidates: PostMergeAuditPromotionCandidate[];
}): PostMergeAuditResult {
  return {
    outcome: derivePostMergeAuditOutcome(args),
    gating: "non_gating",
    mergeBehavior: "unchanged",
    issueCompletionBehavior: "unchanged",
    followUpIssueCreation: "separate_contract",
    recurringPatterns: args.recurringPatterns,
    promotionCandidates: args.promotionCandidates,
  };
}

export function renderPostMergeAuditContractSummary(result: PostMergeAuditResult): string {
  return [
    `- Outcome: ${result.outcome}`,
    `- Gating: ${result.gating.replace("_", "-")}`,
    `- Merge behavior: ${result.mergeBehavior}`,
    `- Issue completion: ${result.issueCompletionBehavior}`,
    `- Follow-up issue creation: ${result.followUpIssueCreation.replace("_", " ")}`,
    `- Recurring-pattern summaries: ${result.recurringPatterns.length}`,
    `- Promotion candidates: ${result.promotionCandidates.length}`,
  ].join("\n");
}
