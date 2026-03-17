import { createExternalReviewRegressionCandidateId } from "./external-review-normalization";
import { type ExternalReviewMissFinding } from "./external-review-classifier";

export interface ExternalReviewRegressionCandidateQualification {
  id: string;
  file: string;
  line: number;
  qualificationReasons: string[];
}

export function qualifyRegressionCandidateFinding(
  finding: ExternalReviewMissFinding,
): ExternalReviewRegressionCandidateQualification | null {
  if (finding.classification !== "missed_by_local_review" || finding.sourceKind !== "review_thread") {
    return null;
  }

  const normalizedFile = typeof finding.file === "string" ? finding.file.trim() : "";
  if (
    finding.severity === "low" ||
    finding.confidence < 0.75 ||
    normalizedFile === "" ||
    typeof finding.line !== "number" ||
    !Number.isInteger(finding.line) ||
    finding.line <= 0
  ) {
    return null;
  }

  return {
    id: createExternalReviewRegressionCandidateId({
      ...finding,
      file: normalizedFile,
    }),
    file: normalizedFile,
    line: finding.line,
    qualificationReasons: ["missed_by_local_review", "non_low_severity", "high_confidence", "file_scoped", "line_scoped"],
  };
}
