import type {
  PostMergeAuditFailurePatternDto,
  PostMergeAuditPromotionCandidateDto,
  PostMergeAuditPromotionCategoryDto,
  PostMergeAuditRecoveryPatternDto,
  PostMergeAuditReviewPatternDto,
} from "./post-merge-audit-summary-schema";

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function compareStringsAscending(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function shouldPromoteReviewPattern(pattern: Pick<PostMergeAuditReviewPatternDto, "artifactCount">): boolean {
  return pattern.artifactCount >= 2;
}

function shouldPromoteFailurePattern(pattern: Pick<PostMergeAuditFailurePatternDto, "artifactCount">): boolean {
  return pattern.artifactCount >= 2;
}

function shouldPromoteRecoveryPattern(pattern: Pick<PostMergeAuditRecoveryPatternDto, "artifactCount">): boolean {
  return pattern.artifactCount >= 2;
}

function createReviewPromotionCandidates(
  pattern: PostMergeAuditReviewPatternDto,
): PostMergeAuditPromotionCandidateDto[] {
  if (!shouldPromoteReviewPattern(pattern)) {
    return [];
  }

  const summaryLabel = pattern.summary.replace(/\.$/u, "");
  return [
    {
      key: `guardrail:${slugify(pattern.key)}`,
      category: "guardrail",
      title: `Promote guardrail for ${summaryLabel}`,
      summary: `Recurring review pattern: ${pattern.summary}`,
      rationale: `This ${pattern.severity}-severity review pattern recurred across ${pattern.artifactCount} post-merge audits.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [...pattern.supportingFindingKeys],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
    {
      key: `shared_memory:${slugify(pattern.key)}`,
      category: "shared_memory",
      title: `Promote shared memory for ${summaryLabel}`,
      summary: `Capture the recurring lesson behind: ${pattern.summary}`,
      rationale: `The same review lesson appeared in ${pattern.artifactCount} merged issues and should stay queryable for future sessions.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [...pattern.supportingFindingKeys],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
  ];
}

function createFailurePromotionCandidates(
  pattern: PostMergeAuditFailurePatternDto,
): PostMergeAuditPromotionCandidateDto[] {
  if (!shouldPromoteFailurePattern(pattern)) {
    return [];
  }

  const summary = pattern.summary ?? "Recurring post-merge failure pattern.";
  const category: PostMergeAuditPromotionCategoryDto =
    pattern.blockedReason === "requirements" ? "documentation" : "checklist";

  return [
    {
      key: `${category}:${slugify(pattern.key)}`,
      category,
      title:
        category === "documentation"
          ? `Document recurring failure pattern ${pattern.key}`
          : `Add checklist coverage for recurring failure pattern ${pattern.key}`,
      summary,
      rationale: `The same failure pattern recurred across ${pattern.artifactCount} post-merge audits with ${pattern.repeatedCount} total repeats.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
  ];
}

function createRecoveryPromotionCandidates(
  pattern: PostMergeAuditRecoveryPatternDto,
): PostMergeAuditPromotionCandidateDto[] {
  if (!shouldPromoteRecoveryPattern(pattern)) {
    return [];
  }

  return [
    {
      key: `documentation:${pattern.key}`,
      category: "documentation",
      title: `Document recovery workflow for ${pattern.key}`,
      summary: pattern.reason,
      rationale: `Operators recovered this way in ${pattern.artifactCount} post-merge audits, so the workflow is a documentation candidate.`,
      sourcePatternKeys: [pattern.key],
      supportingIssueNumbers: [...pattern.supportingIssueNumbers],
      supportingFindingKeys: [],
      advisoryOnly: true,
      autoApply: false,
      autoCreateFollowUpIssue: false,
    },
  ];
}

function comparePromotionCategory(left: PostMergeAuditPromotionCategoryDto, right: PostMergeAuditPromotionCategoryDto): number {
  const order: PostMergeAuditPromotionCategoryDto[] = ["guardrail", "shared_memory", "checklist", "documentation"];
  return order.indexOf(left) - order.indexOf(right);
}


export function buildPostMergeAuditPromotionCandidates(args: {
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  failurePatterns: PostMergeAuditFailurePatternDto[];
  recoveryPatterns: PostMergeAuditRecoveryPatternDto[];
}): PostMergeAuditPromotionCandidateDto[] {
  return [
    ...args.reviewPatterns.flatMap((pattern) => createReviewPromotionCandidates(pattern)),
    ...args.failurePatterns.flatMap((pattern) => createFailurePromotionCandidates(pattern)),
    ...args.recoveryPatterns.flatMap((pattern) => createRecoveryPromotionCandidates(pattern)),
  ].sort((left, right) =>
    comparePromotionCategory(left.category, right.category) ||
    right.supportingIssueNumbers.length - left.supportingIssueNumbers.length ||
    compareStringsAscending(left.key, right.key));
}
