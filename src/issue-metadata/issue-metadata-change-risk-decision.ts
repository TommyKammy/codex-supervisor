import type { GitHubIssue } from "../core/types";
import {
  detectDeterministicChangeClasses,
  type DeterministicChangeClass,
} from "./issue-metadata-change-classification";
import {
  detectRiskyChangeClasses,
  parseRiskyChangeApprovalList,
  type RiskyChangeClass,
} from "./issue-metadata-risky-policy";

export type ChangeRiskVerificationIntensity = "none" | "focused" | "standard" | "strong";
export type ChangeRiskSource = "none" | "issue_metadata" | "changed_files";

export interface ChangeRiskDecisionSummary {
  riskyChangeClasses: RiskyChangeClass[];
  approvedRiskyChangeClasses: RiskyChangeClass[];
  deterministicChangeClasses: DeterministicChangeClass[];
  issueMetadataIntensity: ChangeRiskVerificationIntensity;
  changedFilesIntensity: ChangeRiskVerificationIntensity;
  verificationIntensity: ChangeRiskVerificationIntensity;
  higherRiskSource: ChangeRiskSource;
}

export interface SummarizeChangeRiskDecisionInput {
  issue?: Pick<GitHubIssue, "title" | "body"> | null;
  changedFiles?: string[];
  deterministicChangeClasses?: DeterministicChangeClass[];
}

const VERIFICATION_INTENSITY_ORDER: ChangeRiskVerificationIntensity[] = [
  "none",
  "focused",
  "standard",
  "strong",
];

function normalizeDeterministicChangeClasses(
  input: SummarizeChangeRiskDecisionInput,
): DeterministicChangeClass[] {
  if (input.deterministicChangeClasses) {
    return [...new Set(input.deterministicChangeClasses)].sort();
  }

  return detectDeterministicChangeClasses(input.changedFiles ?? []);
}

function verificationIntensityRank(intensity: ChangeRiskVerificationIntensity): number {
  return VERIFICATION_INTENSITY_ORDER.indexOf(intensity);
}

function maxVerificationIntensity(
  left: ChangeRiskVerificationIntensity,
  right: ChangeRiskVerificationIntensity,
): ChangeRiskVerificationIntensity {
  return verificationIntensityRank(left) >= verificationIntensityRank(right) ? left : right;
}

function verificationIntensityForDeterministicChangeClasses(
  deterministicChangeClasses: DeterministicChangeClass[],
): ChangeRiskVerificationIntensity {
  if (deterministicChangeClasses.length === 0) {
    return "none";
  }

  const hasStrongClass = deterministicChangeClasses.some((changeClass) =>
    ["infrastructure", "schema", "workflow"].includes(changeClass),
  );
  if (hasStrongClass) {
    return "strong";
  }

  const onlyFocusedClasses = deterministicChangeClasses.every((changeClass) =>
    ["docs", "tests"].includes(changeClass),
  );
  return onlyFocusedClasses ? "focused" : "standard";
}

function verificationIntensityForIssueMetadata(riskyChangeClasses: RiskyChangeClass[]): ChangeRiskVerificationIntensity {
  return riskyChangeClasses.length > 0 ? "strong" : "none";
}

function higherRiskSource(args: {
  issueMetadataIntensity: ChangeRiskVerificationIntensity;
  changedFilesIntensity: ChangeRiskVerificationIntensity;
}): ChangeRiskSource {
  const issueMetadataRank = verificationIntensityRank(args.issueMetadataIntensity);
  const changedFilesRank = verificationIntensityRank(args.changedFilesIntensity);

  if (issueMetadataRank === 0 && changedFilesRank === 0) {
    return "none";
  }

  if (issueMetadataRank >= changedFilesRank && issueMetadataRank > 0) {
    return "issue_metadata";
  }

  return "changed_files";
}

export function summarizeChangeRiskDecision(
  input: SummarizeChangeRiskDecisionInput,
): ChangeRiskDecisionSummary {
  const riskyChangeClasses = input.issue ? detectRiskyChangeClasses(input.issue) : [];
  const approvedRiskyChangeClasses = input.issue ? parseRiskyChangeApprovalList(input.issue.body) : [];
  const deterministicChangeClasses = normalizeDeterministicChangeClasses(input);
  const issueMetadataIntensity = verificationIntensityForIssueMetadata(riskyChangeClasses);
  const changedFilesIntensity = verificationIntensityForDeterministicChangeClasses(deterministicChangeClasses);

  return {
    riskyChangeClasses,
    approvedRiskyChangeClasses,
    deterministicChangeClasses,
    issueMetadataIntensity,
    changedFilesIntensity,
    verificationIntensity: maxVerificationIntensity(issueMetadataIntensity, changedFilesIntensity),
    higherRiskSource: higherRiskSource({ issueMetadataIntensity, changedFilesIntensity }),
  };
}
