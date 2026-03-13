import fs from "node:fs/promises";
import path from "node:path";
import { parseJson } from "./utils";
import { legacyReusableMissPatterns } from "./external-review-miss-patterns";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import {
  type ExternalReviewMissPattern,
  type ExternalReviewRegressionCandidate,
} from "./external-review-miss-artifact-types";

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
