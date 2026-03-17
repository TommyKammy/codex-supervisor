import fs from "node:fs/promises";
import path from "node:path";
import {
  compareExternalReviewPatterns,
  loadCommittedExternalReviewGuardrails,
} from "../committed-guardrails";
import { parseJson } from "../core/utils";
import { type ExternalReviewMissPattern } from "./external-review-miss-artifact-types";
import { type ExternalReviewMissArtifactLike, readExternalReviewMissArtifactPatterns } from "./external-review-miss-artifact";

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
  const committedPatterns = args.workspacePath
    ? await loadCommittedExternalReviewGuardrails(args.workspacePath)
    : [];
  if (changedFiles.length === 0) {
    return [];
  }

  const changedFileSet = new Set(changedFiles);
  const deduped = new Map<string, ExternalReviewMissPattern>();

  if (committedPatterns.length > 0) {
    mergeRelevantPatterns(deduped, committedPatterns, changedFileSet);
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

    mergeRelevantPatterns(deduped, readExternalReviewMissArtifactPatterns(artifact, artifactPath), changedFileSet);
  }

  return [...deduped.values()]
    .sort(compareExternalReviewPatterns)
    .slice(0, Math.max(0, args.limit ?? 3));
}
