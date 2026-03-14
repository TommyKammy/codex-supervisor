import { createExternalReviewRegressionCandidateId } from "./external-review-normalization";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import { type ExternalReviewRegressionCandidate } from "./external-review-miss-artifact-types";

export function createRegressionCandidateId(finding: ExternalReviewMissFinding): string {
  return createExternalReviewRegressionCandidateId(finding);
}

export function toRegressionTestCandidate(
  finding: ExternalReviewMissFinding,
): ExternalReviewRegressionCandidate | null {
  if (finding.classification !== "missed_by_local_review") {
    return null;
  }

  const qualificationReasons: string[] = ["missed_by_local_review"];
  if (finding.severity !== "low") {
    qualificationReasons.push("non_low_severity");
  }
  if (finding.confidence >= 0.75) {
    qualificationReasons.push("high_confidence");
  }
  if (typeof finding.file === "string" && finding.file.trim() !== "") {
    qualificationReasons.push("file_scoped");
  }
  if (typeof finding.line === "number" && Number.isInteger(finding.line) && finding.line > 0) {
    qualificationReasons.push("line_scoped");
  }

  if (
    !qualificationReasons.includes("non_low_severity") ||
    !qualificationReasons.includes("high_confidence") ||
    !qualificationReasons.includes("file_scoped") ||
    !qualificationReasons.includes("line_scoped") ||
    !finding.file ||
    finding.line == null
  ) {
    return null;
  }

  const trimmedSummary = finding.summary.replace(/[.!?]+$/, "");
  return {
    id: createRegressionCandidateId(finding),
    title: `Add regression coverage for ${trimmedSummary}`,
    file: finding.file,
    line: finding.line,
    summary: finding.summary,
    rationale: finding.rationale,
    reviewerLogin: finding.reviewerLogin,
    sourceKind: finding.sourceKind,
    sourceId: finding.sourceId,
    sourceThreadId: finding.threadId,
    sourceUrl: finding.url ?? null,
    qualificationReasons,
  };
}
