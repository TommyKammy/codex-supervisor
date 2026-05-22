import { nowIso } from "../core/utils";
import type { SupervisorConfig } from "../core/types";
import { postMergeAuditArtifactDir } from "./post-merge-audit-artifact";
import { aggregatePostMergeAuditArtifacts } from "./post-merge-audit-summary-aggregation";
import { buildPostMergeAuditPromotionCandidates } from "./post-merge-audit-summary-promotion";
import { buildPostMergeAuditEvaluatorWorkflow } from "./post-merge-audit-summary-workflow";

import {
  POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION,
  validatePostMergeAuditPatternSummary,
  type PostMergeAuditPatternSummaryDto,
} from "./post-merge-audit-summary-schema";

export {
  POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION,
  POST_MERGE_AUDIT_PATTERN_SUMMARY_TOP_LEVEL_KEYS,
  validatePostMergeAuditPatternSummary,
  type PostMergeAuditEvaluatorWorkflowDto,
  type PostMergeAuditFailurePatternDto,
  type PostMergeAuditFollowUpCandidateDto,
  type PostMergeAuditPatternSummaryDto,
  type PostMergeAuditPromotionCandidateDto,
  type PostMergeAuditPromotionCategoryDto,
  type PostMergeAuditRecoveryPatternDto,
  type PostMergeAuditReleaseNotesSourceDto,
  type PostMergeAuditReviewPatternDto,
} from "./post-merge-audit-summary-schema";
export async function summarizePostMergeAuditPatterns(
  config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">,
): Promise<PostMergeAuditPatternSummaryDto> {
  const artifactDir = postMergeAuditArtifactDir(config);
  const aggregation = await aggregatePostMergeAuditArtifacts(artifactDir);
  const promotionCandidates = buildPostMergeAuditPromotionCandidates({
    reviewPatterns: aggregation.reviewPatterns,
    failurePatterns: aggregation.failurePatterns,
    recoveryPatterns: aggregation.recoveryPatterns,
  });

  return validatePostMergeAuditPatternSummary({
    schemaVersion: POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION,
    generatedAt: nowIso(),
    artifactDir,
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    artifactsAnalyzed: aggregation.artifactsAnalyzed,
    artifactsSkipped: aggregation.artifactsSkipped,
    reviewPatterns: aggregation.reviewPatterns,
    failurePatterns: aggregation.failurePatterns,
    recoveryPatterns: aggregation.recoveryPatterns,
    followUpCandidates: aggregation.followUpCandidates,
    promotionCandidates,
    releaseNotesSources: aggregation.releaseNotesSources,
    evaluatorWorkflow: buildPostMergeAuditEvaluatorWorkflow({
      artifactsAnalyzed: aggregation.artifactsAnalyzed,
      reviewPatterns: aggregation.reviewPatterns,
      followUpCandidates: aggregation.followUpCandidates,
      releaseNotesSources: aggregation.releaseNotesSources,
    }),
  });
}
export function renderPostMergeAuditPatternSummaryDto(dto: PostMergeAuditPatternSummaryDto): string {
  return JSON.stringify(dto);
}
