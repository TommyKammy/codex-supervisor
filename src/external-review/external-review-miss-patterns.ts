import { truncate } from "../utils";
import {
  createExternalReviewMissPatternFingerprint,
} from "./external-review-normalization";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import {
  type ExternalReviewMissPattern,
  type ExternalReviewPromptFinding,
} from "./external-review-miss-artifact-types";

interface ExternalReviewMissArtifactLike {
  generatedAt?: string;
  headSha?: string;
  findings?: ExternalReviewMissFinding[];
  reusableMissPatterns?: ExternalReviewMissPattern[];
}

export function createMissPatternFingerprint(
  finding: Pick<ExternalReviewPromptFinding, "file" | "summary" | "rationale">,
): string {
  return createExternalReviewMissPatternFingerprint(finding);
}

export function toReusableMissPattern(
  finding: ExternalReviewMissFinding,
  sourceArtifactPath: string,
  sourceHeadSha: string,
  lastSeenAt: string,
): ExternalReviewMissPattern {
  return {
    fingerprint: createMissPatternFingerprint(finding),
    reviewerLogin: finding.reviewerLogin,
    file: finding.file ?? "unknown",
    line: finding.line,
    summary: finding.summary,
    rationale: truncate(finding.rationale, 280) ?? finding.rationale,
    sourceArtifactPath,
    sourceHeadSha,
    lastSeenAt,
  };
}

export function legacyReusableMissPatterns(
  artifact: ExternalReviewMissArtifactLike,
  artifactPath: string,
): ExternalReviewMissPattern[] {
  const generatedAt = typeof artifact.generatedAt === "string" ? artifact.generatedAt : "";
  const headSha = typeof artifact.headSha === "string" ? artifact.headSha : "";
  return (artifact.findings ?? [])
    .filter(
      (finding) =>
        finding.classification === "missed_by_local_review" &&
        typeof finding.file === "string" &&
        finding.file.trim() !== "",
    )
    .map((finding) => toReusableMissPattern(finding, artifactPath, headSha, generatedAt));
}
