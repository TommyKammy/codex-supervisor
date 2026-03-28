import { nowIso } from "../core/utils";
import { hasMatchingPromotionIdentity, isNullablePromotionEvidenceString } from "../persisted-artifact-promotion";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import {
  type ExternalReviewArtifactFinding,
  type ExternalReviewDurableGuardrailCandidate,
  type ExternalReviewMissArtifact,
  type ExternalReviewMissContext,
  type ExternalReviewMissPattern,
  type ExternalReviewRegressionCandidate,
} from "./external-review-miss-artifact-types";
import { legacyReusableMissPatterns } from "./external-review-miss-patterns";
import { toDurableGuardrailCandidates } from "./external-review-durable-guardrail-candidates";
import { toReusableMissPattern } from "./external-review-miss-patterns";
import { assignExternalReviewPreventionTarget } from "./external-review-prevention-targets";
import { toRegressionTestCandidate } from "./external-review-regression-candidates";

export interface ExternalReviewMissArtifactLike {
  issueNumber?: number;
  prNumber?: number;
  branch?: string;
  headSha?: string;
  generatedAt?: string;
  findings?: ExternalReviewMissFinding[];
  durableGuardrailCandidates?: ExternalReviewDurableGuardrailCandidate[];
  reusableMissPatterns?: ExternalReviewMissPattern[];
  regressionTestCandidates?: ExternalReviewRegressionCandidate[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isExternalReviewMissPatternLike(value: unknown): value is ExternalReviewMissPattern {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const pattern = value as Record<string, unknown>;
  return (
    isNonEmptyString(pattern.fingerprint) &&
    isNonEmptyString(pattern.reviewerLogin) &&
    isNonEmptyString(pattern.file) &&
    isPositiveIntegerOrNull(pattern.line) &&
    isNonEmptyString(pattern.summary) &&
    isNonEmptyString(pattern.rationale) &&
    isNonEmptyString(pattern.sourceArtifactPath) &&
    isNonEmptyString(pattern.sourceHeadSha) &&
    isNonEmptyString(pattern.lastSeenAt)
  );
}

function isDurableGuardrailCandidateLike(value: unknown): value is ExternalReviewDurableGuardrailCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const provenance = candidate.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return false;
  }

  const typedProvenance = provenance as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    (candidate.category === "reviewer_rubric" || candidate.category === "verifier" || candidate.category === "regression_test") &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.reviewerLogin) &&
    (candidate.file === null || isNonEmptyString(candidate.file)) &&
    isPositiveIntegerOrNull(candidate.line) &&
    isNonEmptyString(candidate.summary) &&
    isNonEmptyString(candidate.rationale) &&
    isStringArray(candidate.qualificationReasons) &&
    typeof typedProvenance.issueNumber === "number" &&
    Number.isInteger(typedProvenance.issueNumber) &&
    typeof typedProvenance.prNumber === "number" &&
    Number.isInteger(typedProvenance.prNumber) &&
    isNonEmptyString(typedProvenance.branch) &&
    isNonEmptyString(typedProvenance.headSha) &&
    isNonEmptyString(typedProvenance.sourceKind) &&
    isNonEmptyString(typedProvenance.sourceId) &&
    isNullablePromotionEvidenceString(typedProvenance.sourceThreadId) &&
    isNullablePromotionEvidenceString(typedProvenance.sourceUrl) &&
    isNonEmptyString(typedProvenance.sourceArtifactPath) &&
    isNullablePromotionEvidenceString(typedProvenance.localReviewSummaryPath) &&
    isNullablePromotionEvidenceString(typedProvenance.localReviewFindingsPath) &&
    isNullablePromotionEvidenceString(typedProvenance.matchedLocalReference) &&
    isNonEmptyString(typedProvenance.matchReason)
  );
}

function isRegressionTestCandidateLike(value: unknown): value is ExternalReviewRegressionCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.file) &&
    isPositiveIntegerOrNull(candidate.line) &&
    candidate.line !== null &&
    isNonEmptyString(candidate.summary) &&
    isNonEmptyString(candidate.rationale) &&
    isNonEmptyString(candidate.reviewerLogin) &&
    isNonEmptyString(candidate.sourceKind) &&
    isNonEmptyString(candidate.sourceId) &&
    isNullablePromotionEvidenceString(candidate.sourceThreadId) &&
    isNullablePromotionEvidenceString(candidate.sourceUrl) &&
    isStringArray(candidate.qualificationReasons)
  );
}

export function isPromotableExternalReviewMissArtifact(
  artifact: ExternalReviewMissArtifactLike,
  context: {
    issueNumber?: number;
    prNumber?: number;
    branch: string;
    headSha?: string;
  },
): boolean {
  if (!hasMatchingPromotionIdentity(artifact, context)) {
    return false;
  }

  if (artifact.reusableMissPatterns && !artifact.reusableMissPatterns.every((pattern) => isExternalReviewMissPatternLike(pattern))) {
    return false;
  }
  if (
    artifact.durableGuardrailCandidates &&
    !artifact.durableGuardrailCandidates.every((candidate) => isDurableGuardrailCandidateLike(candidate))
  ) {
    return false;
  }
  if (
    artifact.regressionTestCandidates &&
    !artifact.regressionTestCandidates.every((candidate) => isRegressionTestCandidateLike(candidate))
  ) {
    return false;
  }

  return true;
}

export function readExternalReviewMissArtifactPatterns(
  artifact: ExternalReviewMissArtifactLike,
  artifactPath: string,
): ExternalReviewMissPattern[] {
  return Array.isArray(artifact.reusableMissPatterns)
    ? artifact.reusableMissPatterns
    : legacyReusableMissPatterns(artifact, artifactPath);
}

export function buildExternalReviewMissArtifact(args: {
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  localReviewSummaryPath: string | null;
  localReviewFindingsPath: string | null;
  findings: ExternalReviewMissFinding[];
  artifactPath: string;
}): ExternalReviewMissArtifact {
  const generatedAt = nowIso();
  const findings: ExternalReviewArtifactFinding[] = args.findings.map((finding) => ({
    ...finding,
    preventionTarget: assignExternalReviewPreventionTarget(finding),
  }));

  const reusableMissPatterns: ExternalReviewMissPattern[] = findings
    .filter((finding) => finding.classification === "missed_by_local_review" && typeof finding.file === "string" && finding.file.trim() !== "")
    .map((finding) => toReusableMissPattern(finding, args.artifactPath, args.headSha, generatedAt));
  const durableGuardrailCandidates: ExternalReviewDurableGuardrailCandidate[] = findings.flatMap((finding) =>
    toDurableGuardrailCandidates({
      issueNumber: args.issueNumber,
      prNumber: args.prNumber,
      branch: args.branch,
      headSha: args.headSha,
      sourceArtifactPath: args.artifactPath,
      localReviewSummaryPath: args.localReviewSummaryPath,
      localReviewFindingsPath: args.localReviewFindingsPath,
      finding,
    }),
  );
  const regressionTestCandidates = findings
    .map((finding) => toRegressionTestCandidate(finding))
    .filter((candidate): candidate is ExternalReviewRegressionCandidate => candidate !== null);

  return {
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    branch: args.branch,
    headSha: args.headSha,
    generatedAt,
    localReviewSummaryPath: args.localReviewSummaryPath,
    localReviewFindingsPath: args.localReviewFindingsPath,
    findings,
    reusableMissPatterns,
    durableGuardrailCandidates,
    regressionTestCandidates,
    counts: {
      matched: findings.filter((finding) => finding.classification === "matched").length,
      nearMatch: findings.filter((finding) => finding.classification === "near_match").length,
      missedByLocalReview: findings.filter((finding) => finding.classification === "missed_by_local_review").length,
    },
  };
}

export function createExternalReviewMissContext(args: {
  artifactPath: string;
  artifact: ExternalReviewMissArtifact;
}): ExternalReviewMissContext {
  return {
    artifactPath: args.artifactPath,
    missedFindings: args.artifact.findings.filter((finding) => finding.classification === "missed_by_local_review"),
    regressionTestCandidates: args.artifact.regressionTestCandidates,
    matchedCount: args.artifact.counts.matched,
    nearMatchCount: args.artifact.counts.nearMatch,
    missedCount: args.artifact.counts.missedByLocalReview,
  };
}
