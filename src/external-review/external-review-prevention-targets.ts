import { type ExternalReviewMissFinding } from "./external-review-classifier";
import { qualifyRegressionCandidateFinding } from "./external-review-regression-candidate-qualification";

export type ExternalReviewPreventionTarget =
  | "durable_guardrail"
  | "regression_test"
  | "review_prompt"
  | "issue_template";

function qualifiesDurableGuardrailTarget(finding: ExternalReviewMissFinding): boolean {
  const normalizedFile = typeof finding.file === "string" ? finding.file.trim() : "";
  return (
    finding.sourceKind === "review_thread" &&
    finding.severity === "high" &&
    finding.confidence >= 0.75 &&
    normalizedFile !== "" &&
    typeof finding.line === "number" &&
    Number.isInteger(finding.line) &&
    finding.line > 0
  );
}

export function assignExternalReviewPreventionTarget(
  finding: ExternalReviewMissFinding,
): ExternalReviewPreventionTarget | null {
  if (finding.classification !== "missed_by_local_review") {
    return null;
  }

  if (finding.sourceKind === "issue_comment") {
    return "issue_template";
  }

  if (finding.sourceKind === "top_level_review") {
    return "review_prompt";
  }

  if (qualifiesDurableGuardrailTarget(finding)) {
    return "durable_guardrail";
  }

  if (qualifyRegressionCandidateFinding(finding)) {
    return "regression_test";
  }

  return "review_prompt";
}
