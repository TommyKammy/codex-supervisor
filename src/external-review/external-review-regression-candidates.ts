import { createExternalReviewRegressionCandidateId } from "./external-review-normalization";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import { type ExternalReviewRegressionCandidate } from "./external-review-miss-artifact-types";
import { qualifyRegressionCandidateFinding } from "./external-review-regression-candidate-qualification";

export function createRegressionCandidateId(finding: ExternalReviewMissFinding): string {
  return createExternalReviewRegressionCandidateId(finding);
}

export function toRegressionTestCandidate(
  finding: ExternalReviewMissFinding,
): ExternalReviewRegressionCandidate | null {
  const qualification = qualifyRegressionCandidateFinding(finding);
  if (!qualification) {
    return null;
  }

  const trimmedSummary = finding.summary.replace(/[.!?]+$/, "");
  return {
    id: qualification.id,
    title: `Add regression coverage for ${trimmedSummary}`,
    file: qualification.file,
    line: qualification.line,
    summary: finding.summary,
    rationale: finding.rationale,
    reviewerLogin: finding.reviewerLogin,
    sourceKind: finding.sourceKind,
    sourceId: finding.sourceId,
    sourceThreadId: finding.threadId,
    sourceUrl: finding.url ?? null,
    qualificationReasons: qualification.qualificationReasons,
  };
}
