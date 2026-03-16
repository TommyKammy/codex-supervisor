import { type LocalReviewRoleSelection } from "../review-role-detector";
import { type ActionableSeverity, type LocalReviewFinding, type LocalReviewReviewerThresholdConfig, type LocalReviewReviewerType } from "./types";
import { type SupervisorConfig } from "../types";

const SEVERITY_WEIGHT: Record<ActionableSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function reviewerTypeForRole(args: {
  role: string;
  detectedRoles?: LocalReviewRoleSelection[];
}): LocalReviewReviewerType {
  const detectedRole = args.detectedRoles?.find((selection) => selection.role === args.role);
  if (detectedRole && detectedRole.reasons.every((reason) => reason.kind === "baseline")) {
    return "generic";
  }

  return args.role === "reviewer" || args.role === "explorer" ? "generic" : "specialist";
}

export function thresholdsForReviewerType(
  config: Pick<SupervisorConfig, "localReviewReviewerThresholds">,
  reviewerType: LocalReviewReviewerType,
): LocalReviewReviewerThresholdConfig {
  return config.localReviewReviewerThresholds[reviewerType];
}

export function findingMeetsReviewerThreshold(args: {
  finding: LocalReviewFinding;
  reviewerType: LocalReviewReviewerType;
  config: Pick<SupervisorConfig, "localReviewReviewerThresholds">;
}): boolean {
  const thresholds = thresholdsForReviewerType(args.config, args.reviewerType);
  return (
    args.finding.confidence >= thresholds.confidenceThreshold &&
    SEVERITY_WEIGHT[args.finding.severity] >= SEVERITY_WEIGHT[thresholds.minimumSeverity]
  );
}
