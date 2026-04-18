import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../core/utils";
import { normalizeDurableTrackedArtifactContent } from "../core/journal";
import {
  classifyExternalReviewFinding,
  type LocalReviewArtifactLike,
} from "./external-review-classifier";
import {
  normalizeExternalReviewSignal,
  type NormalizedExternalReviewFinding,
} from "./external-review-normalization";
import { collectExternalReviewSignals } from "./external-review-signal-collection";
import { type ExternalReviewSignalEnvelope } from "./external-review-signals";
import {
  type ExternalReviewMissContext,
} from "./external-review-miss-artifact-types";
import {
  buildExternalReviewMissArtifact,
  createExternalReviewMissContext,
} from "./external-review-miss-artifact";
import {
  buildExternalReviewMissFollowUpDigest,
  externalReviewMissFollowUpDigestPath,
} from "./external-review-miss-digest";
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
  const digestPath = externalReviewMissFollowUpDigestPath(artifactPath);
  const digest = buildExternalReviewMissFollowUpDigest({
    artifactPath,
    artifact,
    activeHeadSha: args.headSha,
    localReviewSummaryPath: args.localReviewSummaryPath,
    localReviewHeadSha: localArtifact.headSha ?? null,
  });

  await fs.writeFile(
    artifactPath,
    normalizeDurableTrackedArtifactContent(`${JSON.stringify(artifact, null, 2)}\n`, args.artifactDir),
    "utf8",
  );
  await fs.writeFile(digestPath, normalizeDurableTrackedArtifactContent(digest, args.artifactDir), "utf8");

  return createExternalReviewMissContext({
    artifactPath,
    artifact,
  });
}

export type { LocalReviewArtifactLike };
