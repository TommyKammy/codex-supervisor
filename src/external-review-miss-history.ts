import fs from "node:fs/promises";
import path from "node:path";
import {
  compareExternalReviewPatterns,
  loadCommittedExternalReviewGuardrails,
} from "./committed-guardrails";
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

function mergeRelevantPatterns(
  deduped: Map<string, ExternalReviewMissPattern>,
  patterns: ExternalReviewMissPattern[],
  changedFileSet: ReadonlySet<string>,
): void {
  for (const pattern of patterns) {
    if (!changedFileSet.has(pattern.file)) {
      continue;
    }

    const existing = deduped.get(pattern.fingerprint);
    if (!existing || compareExternalReviewPatterns(pattern, existing) < 0) {
      deduped.set(pattern.fingerprint, pattern);
    }
  }
}

export async function loadRelevantExternalReviewMissPatterns(args: {
  artifactDir: string;
  branch: string;
  currentHeadSha: string;
  changedFiles: string[];
  limit?: number;
  workspacePath?: string;
}): Promise<ExternalReviewMissPattern[]> {
  const changedFiles = [...new Set(args.changedFiles.filter((filePath) => filePath.trim() !== ""))].sort();
  if (changedFiles.length === 0) {
    return [];
  }

  const changedFileSet = new Set(changedFiles);
  const deduped = new Map<string, ExternalReviewMissPattern>();

  if (args.workspacePath) {
    mergeRelevantPatterns(deduped, await loadCommittedExternalReviewGuardrails(args.workspacePath), changedFileSet);
  }

  let entries: string[];
  try {
    entries = await fs.readdir(args.artifactDir);
  } catch {
    return [...deduped.values()]
      .sort(compareExternalReviewPatterns)
      .slice(0, Math.max(0, args.limit ?? 3));
  }

  const artifactPaths = entries
    .filter((entry) => /^external-review-misses-head-.*\.json$/i.test(entry))
    .sort()
    .map((entry) => path.join(args.artifactDir, entry));

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
    mergeRelevantPatterns(deduped, reusableMissPatterns, changedFileSet);
  }

  return [...deduped.values()]
    .sort(compareExternalReviewPatterns)
    .slice(0, Math.max(0, args.limit ?? 3));
}
