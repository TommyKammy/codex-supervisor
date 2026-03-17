import { nowIso } from "../core/utils";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import {
  type ExternalReviewDurableGuardrailCandidate,
  type ExternalReviewMissArtifact,
  type ExternalReviewMissContext,
  type ExternalReviewMissPattern,
  type ExternalReviewRegressionCandidate,
} from "./external-review-miss-artifact-types";
import { legacyReusableMissPatterns } from "./external-review-miss-patterns";
import { toDurableGuardrailCandidates } from "./external-review-durable-guardrail-candidates";
import { toReusableMissPattern } from "./external-review-miss-patterns";
import { toRegressionTestCandidate } from "./external-review-regression-candidates";

export interface ExternalReviewMissArtifactLike {
  branch?: string;
  headSha?: string;
  generatedAt?: string;
  findings?: ExternalReviewMissFinding[];
  reusableMissPatterns?: ExternalReviewMissPattern[];
  regressionTestCandidates?: ExternalReviewRegressionCandidate[];
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

  const reusableMissPatterns: ExternalReviewMissPattern[] = args.findings
    .filter((finding) => finding.classification === "missed_by_local_review" && typeof finding.file === "string" && finding.file.trim() !== "")
    .map((finding) => toReusableMissPattern(finding, args.artifactPath, args.headSha, generatedAt));
  const durableGuardrailCandidates: ExternalReviewDurableGuardrailCandidate[] = args.findings.flatMap((finding) =>
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
  const regressionTestCandidates = args.findings
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
    findings: args.findings,
    reusableMissPatterns,
    durableGuardrailCandidates,
    regressionTestCandidates,
    counts: {
      matched: args.findings.filter((finding) => finding.classification === "matched").length,
      nearMatch: args.findings.filter((finding) => finding.classification === "near_match").length,
      missedByLocalReview: args.findings.filter((finding) => finding.classification === "missed_by_local_review").length,
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
