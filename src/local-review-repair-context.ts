import fs from "node:fs";
import path from "node:path";
import { loadRelevantExternalReviewMissPatterns } from "./external-review-misses";
import { parseJson } from "./utils";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";

interface LocalReviewRepairArtifact {
  branch?: string;
  headSha?: string;
  actionableFindings?: Array<{ file?: string | null }>;
  rootCauseSummaries?: Array<{
    severity?: "low" | "medium" | "high";
    summary?: string;
    file?: string | null;
    start?: number | null;
    end?: number | null;
  }>;
}

function normalizeRepairContextFilePath(file: string | null | undefined): string | null {
  if (typeof file !== "string") {
    return null;
  }

  const trimmed = file.trim();
  return trimmed === "" ? null : trimmed;
}

export async function loadLocalReviewRepairContext(summaryPath: string | null, workspacePath?: string) {
  if (!summaryPath) {
    return null;
  }

  const findingsPath =
    path.extname(summaryPath) === ".md"
      ? `${summaryPath.slice(0, -3)}.json`
      : null;
  if (!findingsPath) {
    return null;
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(findingsPath, "utf8");
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const artifact = parseJson<LocalReviewRepairArtifact>(raw, findingsPath);
  const rootCauses = (artifact.rootCauseSummaries ?? [])
    .filter((rootCause) => typeof rootCause.summary === "string" && rootCause.summary.trim() !== "")
    .slice(0, 5)
    .map((rootCause) => {
      const start = typeof rootCause.start === "number" ? rootCause.start : null;
      const end = typeof rootCause.end === "number" ? rootCause.end : start;
      return {
        severity: rootCause.severity ?? "medium",
        summary: rootCause.summary!.trim(),
        file: normalizeRepairContextFilePath(rootCause.file),
        lines:
          start == null
            ? null
            : end != null && end !== start
              ? `${start}-${end}`
              : `${start}`,
      };
    });
  const relevantFiles = [...new Set([
    ...rootCauses.map((rootCause) => rootCause.file).filter((filePath): filePath is string => Boolean(filePath)),
    ...(artifact.actionableFindings ?? [])
      .map((finding) => normalizeRepairContextFilePath(finding.file))
      .filter((filePath): filePath is string => Boolean(filePath)),
  ])].slice(0, 10);
  const priorMissPatterns =
    workspacePath && typeof artifact.branch === "string" && typeof artifact.headSha === "string"
      ? await loadRelevantExternalReviewMissPatterns({
          artifactDir: path.dirname(summaryPath),
          branch: artifact.branch,
          currentHeadSha: artifact.headSha,
          changedFiles: relevantFiles,
          limit: 3,
          workspacePath,
        })
      : [];
  const verifierGuardrails =
    workspacePath
      ? await loadRelevantVerifierGuardrails({
          workspacePath,
          changedFiles: relevantFiles,
          limit: 3,
        })
      : [];

  return {
    summaryPath,
    findingsPath,
    relevantFiles,
    rootCauses,
    priorMissPatterns,
    verifierGuardrails,
  };
}
