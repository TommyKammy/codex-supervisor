import path from "node:path";
import {
  EXTERNAL_REVIEW_GUARDRAILS_PATH,
  VERIFIER_GUARDRAILS_PATH,
} from "./committed-guardrails";
import { type ExternalReviewMissPattern } from "./external-review-misses";
import { type FinalizedLocalReview, type LocalReviewResult, type LocalReviewVerifierReport } from "./local-review-types";
import { truncate } from "./utils";
import { type SupervisorConfig } from "./types";

export const LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY = "degraded local review; inspect the saved artifact";

function formatBlockerLocation(args: { file: string | null; start: number | null; end: number | null }): string | null {
  if (!args.file) {
    return null;
  }
  if (args.start == null) {
    return args.file;
  }

  return args.end != null && args.end !== args.start
    ? `${args.file}:${args.start}-${args.end}`
    : `${args.file}:${args.start}`;
}

export function buildLocalReviewBlockerSummary(
  review: Pick<FinalizedLocalReview, "recommendation" | "degraded" | "maxSeverity" | "rootCauseCount" | "rootCauseSummaries">,
): string | null {
  if (review.recommendation === "ready") {
    return null;
  }
  if (review.degraded) {
    return LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY;
  }

  const primary = review.rootCauseSummaries[0];
  if (!primary) {
    return review.rootCauseCount > 0 || review.maxSeverity !== "none"
      ? `${review.maxSeverity} severity local-review findings`
      : null;
  }

  const location = formatBlockerLocation(primary);
  const extraCount = Math.max(review.rootCauseSummaries.length - 1, 0);
  return truncate(
    [
      primary.severity,
      location,
      primary.summary,
      extraCount > 0 ? `(+${extraCount} more root cause${extraCount === 1 ? "" : "s"})` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" "),
    160,
  );
}

function displayGuardrailArtifactPath(config: Pick<SupervisorConfig, "localReviewArtifactDir">, filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    return path.basename(filePath);
  }

  const relativePath = path.relative(config.localReviewArtifactDir, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath
    : path.basename(filePath);
}

export function prepareLocalReviewGuardrailProvenance(args: {
  config: Pick<SupervisorConfig, "localReviewArtifactDir">;
  verifierReport: LocalReviewVerifierReport | null;
  committedExternalReviewPatterns: ExternalReviewMissPattern[];
  runtimeExternalReviewPatterns: ExternalReviewMissPattern[];
}): FinalizedLocalReview["artifact"]["guardrailProvenance"] {
  return {
    verifier: {
      committedPath:
        (args.verifierReport?.verifierGuardrails?.length ?? 0) > 0 ? VERIFIER_GUARDRAILS_PATH : null,
      committedCount: args.verifierReport?.verifierGuardrails?.length ?? 0,
    },
    externalReview: {
      committedPath: args.committedExternalReviewPatterns.length > 0 ? EXTERNAL_REVIEW_GUARDRAILS_PATH : null,
      committedCount: args.committedExternalReviewPatterns.length,
      runtimeSources: [...new Set(args.runtimeExternalReviewPatterns.map((pattern) => pattern.sourceArtifactPath))]
        .sort()
        .map((sourcePath) => ({
          path: displayGuardrailArtifactPath(args.config, sourcePath),
          count: args.runtimeExternalReviewPatterns.filter((pattern) => pattern.sourceArtifactPath === sourcePath).length,
        })),
    },
  };
}

export function formatLocalReviewResult(args: {
  ranAt: string;
  finalized: FinalizedLocalReview;
  artifacts: Pick<LocalReviewResult, "summaryPath" | "findingsPath" | "rawOutput">;
}): LocalReviewResult {
  return {
    ranAt: args.ranAt,
    summaryPath: args.artifacts.summaryPath,
    findingsPath: args.artifacts.findingsPath,
    summary: args.finalized.summary,
    blockerSummary: buildLocalReviewBlockerSummary(args.finalized),
    findingsCount: args.finalized.findingsCount,
    rootCauseCount: args.finalized.rootCauseCount,
    maxSeverity: args.finalized.maxSeverity,
    verifiedFindingsCount: args.finalized.verifiedFindingsCount,
    verifiedMaxSeverity: args.finalized.verifiedMaxSeverity,
    recommendation: args.finalized.recommendation,
    degraded: args.finalized.degraded,
    rawOutput: args.artifacts.rawOutput,
  };
}
