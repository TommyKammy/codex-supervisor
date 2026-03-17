import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso } from "../core/utils";
import {
  classifyExternalReviewFinding,
  type ExternalReviewMissFinding,
  type LocalReviewArtifactLike,
} from "./external-review-classifier";
import {
  normalizeExternalReviewSignal,
  type NormalizedExternalReviewFinding,
} from "./external-review-normalization";
import { collectExternalReviewSignals } from "./external-review-signal-collection";
import { type ExternalReviewSignalEnvelope } from "./external-review-signals";
import {
  type ExternalReviewMissArtifact,
  type ExternalReviewDurableGuardrailCandidate,
  type ExternalReviewMissContext,
  type ExternalReviewMissPattern,
  type ExternalReviewRegressionCandidate,
} from "./external-review-miss-artifact-types";
import { toDurableGuardrailCandidates } from "./external-review-durable-guardrail-candidates";
import { toReusableMissPattern } from "./external-review-miss-patterns";
import { toRegressionTestCandidate } from "./external-review-regression-candidates";
import { loadLocalReviewArtifact } from "./external-review-local-artifact-io";
import { type ReviewThread } from "../core/types";

export async function writeExternalReviewMissArtifact(args: {
  artifactDir: string;
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  reviewThreads?: ReviewThread[];
  reviewSignals?: ExternalReviewSignalEnvelope[];
  reviewBotLogins: string[];
  localReviewSummaryPath: string | null;
}): Promise<ExternalReviewMissContext | null> {
  const normalizedFindings = (args.reviewSignals ??
    collectExternalReviewSignals({
      reviewThreads: args.reviewThreads ?? [],
      reviewBotLogins: args.reviewBotLogins,
    }))
    .map((signal) => normalizeExternalReviewSignal(signal))
    .filter((finding): finding is NormalizedExternalReviewFinding => finding !== null);

  if (normalizedFindings.length === 0) {
    return null;
  }

  const { findingsPath: localReviewFindingsPath, artifact: localArtifact, available } = await loadLocalReviewArtifact(args.localReviewSummaryPath);
  if (!available || !localArtifact) {
    return null;
  }

  const findings = normalizedFindings.map((finding) => classifyExternalReviewFinding(finding, localArtifact));
  await ensureDir(args.artifactDir);
  const artifactPath = path.join(args.artifactDir, `external-review-misses-head-${args.headSha.slice(0, 12)}.json`);
  const artifact = buildExternalReviewMissArtifact({
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    branch: args.branch,
    headSha: args.headSha,
    localReviewSummaryPath: args.localReviewSummaryPath,
    localReviewFindingsPath,
    findings,
    artifactPath,
  });

  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return {
    artifactPath,
    missedFindings: findings.filter((finding) => finding.classification === "missed_by_local_review"),
    regressionTestCandidates: artifact.regressionTestCandidates,
    matchedCount: artifact.counts.matched,
    nearMatchCount: artifact.counts.nearMatch,
    missedCount: artifact.counts.missedByLocalReview,
  };
}

function buildExternalReviewMissArtifact(args: {
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

export type { LocalReviewArtifactLike, ExternalReviewMissPattern };
