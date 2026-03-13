import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, parseJson } from "./utils";
import {
  normalizeExternalReviewFinding,
  type NormalizedExternalReviewFinding,
} from "./external-review-normalization";
import {
  classifyExternalReviewFinding,
  type ExternalReviewMatch,
  type ExternalReviewMissFinding,
  type LocalReviewArtifactLike,
} from "./external-review-classifier";
import {
  type ExternalReviewMissArtifact,
  type ExternalReviewMissContext,
  type ExternalReviewMissPattern,
  type ExternalReviewPromptFinding,
  type ExternalReviewRegressionCandidate,
} from "./external-review-miss-artifact-types";
import { legacyReusableMissPatterns, toReusableMissPattern } from "./external-review-miss-patterns";
import { toRegressionTestCandidate } from "./external-review-regression-candidates";
import { type ReviewThread } from "./types";

async function loadLocalReviewArtifact(summaryPath: string | null): Promise<{
  findingsPath: string | null;
  artifact: LocalReviewArtifactLike | null;
  available: boolean;
}> {
  if (!summaryPath || path.extname(summaryPath) !== ".md") {
    return { findingsPath: null, artifact: null, available: false };
  }

  const findingsPath = `${summaryPath.slice(0, -3)}.json`;
  try {
    const raw = await fs.readFile(findingsPath, "utf8");
    return {
      findingsPath,
      artifact: parseJson<LocalReviewArtifactLike>(raw, findingsPath),
      available: true,
    };
  } catch {
    return { findingsPath, artifact: null, available: false };
  }
}

interface ExternalReviewMissArtifactLike {
  branch?: string;
  headSha?: string;
  generatedAt?: string;
  findings?: ExternalReviewMissFinding[];
  reusableMissPatterns?: ExternalReviewMissPattern[];
  regressionTestCandidates?: ExternalReviewRegressionCandidate[];
}

export async function loadRelevantExternalReviewMissPatterns(args: {
  artifactDir: string;
  branch: string;
  currentHeadSha: string;
  changedFiles: string[];
  limit?: number;
}): Promise<ExternalReviewMissPattern[]> {
  const changedFiles = [...new Set(args.changedFiles.filter((filePath) => filePath.trim() !== ""))].sort();
  if (changedFiles.length === 0) {
    return [];
  }

  let entries: string[];
  try {
    entries = await fs.readdir(args.artifactDir);
  } catch {
    return [];
  }

  const artifactPaths = entries
    .filter((entry) => /^external-review-misses-head-.*\.json$/i.test(entry))
    .sort()
    .map((entry) => path.join(args.artifactDir, entry));
  const changedFileSet = new Set(changedFiles);
  const deduped = new Map<string, ExternalReviewMissPattern>();

  for (const artifactPath of artifactPaths) {
    let raw: string;
    try {
      raw = await fs.readFile(artifactPath, "utf8");
    } catch {
      continue;
    }

    const artifact = parseJson<ExternalReviewMissArtifactLike>(raw, artifactPath);
    if (artifact.branch !== args.branch || artifact.headSha === args.currentHeadSha) {
      continue;
    }

    const reusableMissPatterns =
      Array.isArray(artifact.reusableMissPatterns) && artifact.reusableMissPatterns.length > 0
        ? artifact.reusableMissPatterns
        : legacyReusableMissPatterns(artifact, artifactPath);
    for (const pattern of reusableMissPatterns) {
      if (!pattern.file || !changedFileSet.has(pattern.file)) {
        continue;
      }

      const existing = deduped.get(pattern.fingerprint);
      if (!existing || pattern.lastSeenAt > existing.lastSeenAt) {
        deduped.set(pattern.fingerprint, pattern);
      }
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const lastSeenComparison = right.lastSeenAt.localeCompare(left.lastSeenAt);
      if (lastSeenComparison !== 0) {
        return lastSeenComparison;
      }

      const fileComparison = left.file.localeCompare(right.file);
      if (fileComparison !== 0) {
        return fileComparison;
      }

      const lineComparison = (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
      if (lineComparison !== 0) {
        return lineComparison;
      }

      return left.fingerprint.localeCompare(right.fingerprint);
    })
    .slice(0, Math.max(0, args.limit ?? 3));
}

export async function writeExternalReviewMissArtifact(args: {
  artifactDir: string;
  issueNumber: number;
  prNumber: number;
  branch: string;
  headSha: string;
  reviewThreads: ReviewThread[];
  reviewBotLogins: string[];
  localReviewSummaryPath: string | null;
}): Promise<ExternalReviewMissContext | null> {
  const normalizedFindings = args.reviewThreads
    .map((thread) => normalizeExternalReviewFinding(thread, args.reviewBotLogins))
    .filter((finding): finding is NormalizedExternalReviewFinding => finding !== null);

  if (normalizedFindings.length === 0) {
    return null;
  }

  const { findingsPath: localReviewFindingsPath, artifact: localArtifact, available } = await loadLocalReviewArtifact(args.localReviewSummaryPath);
  if (!available || !localArtifact) {
    return null;
  }

  const findings = normalizedFindings.map((finding) => classifyExternalReviewFinding(finding, localArtifact));
  const artifact: ExternalReviewMissArtifact = {
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    branch: args.branch,
    headSha: args.headSha,
    generatedAt: nowIso(),
    localReviewSummaryPath: args.localReviewSummaryPath,
    localReviewFindingsPath,
    findings,
    reusableMissPatterns: [],
    regressionTestCandidates: [],
    counts: {
      matched: findings.filter((finding) => finding.classification === "matched").length,
      nearMatch: findings.filter((finding) => finding.classification === "near_match").length,
      missedByLocalReview: findings.filter((finding) => finding.classification === "missed_by_local_review").length,
    },
  };

  await ensureDir(args.artifactDir);
  const artifactPath = path.join(args.artifactDir, `external-review-misses-head-${args.headSha.slice(0, 12)}.json`);
  artifact.reusableMissPatterns = findings
    .filter((finding) => finding.classification === "missed_by_local_review" && typeof finding.file === "string" && finding.file.trim() !== "")
    .map((finding) => toReusableMissPattern(finding, artifactPath, args.headSha, artifact.generatedAt));
  artifact.regressionTestCandidates = findings
    .map((finding) => toRegressionTestCandidate(finding))
    .filter((candidate): candidate is ExternalReviewRegressionCandidate => candidate !== null);
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

export {
  classifyExternalReviewFinding,
  normalizeExternalReviewFinding,
  type ExternalReviewMissArtifact,
  type ExternalReviewMatch,
  type ExternalReviewMissContext,
  type ExternalReviewMissFinding,
  type ExternalReviewMissPattern,
  type ExternalReviewPromptFinding,
  type ExternalReviewRegressionCandidate,
  type LocalReviewArtifactLike,
  type NormalizedExternalReviewFinding,
};
