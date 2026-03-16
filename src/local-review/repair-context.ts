import fs from "node:fs";
import path from "node:path";
import { type LocalReviewRepairContext } from "../codex/codex-prompt";
import { loadRelevantExternalReviewMissPatterns } from "../external-review/external-review-misses";
import { parseJson } from "../utils";
import { loadRelevantVerifierGuardrails } from "../verifier-guardrails";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRootCauseSeverity(value: unknown): value is LocalReviewRepairContext["rootCauses"][number]["severity"] {
  return value === "low" || value === "medium" || value === "high";
}

function hasUsableRootCauseSummary(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { summary: string } {
  return typeof value.summary === "string" && value.summary.trim() !== "";
}

function normalizeRepairContextFilePath(file: unknown): string | null {
  if (typeof file !== "string") {
    return null;
  }

  const trimmed = file.trim();
  return trimmed === "" ? null : trimmed;
}

function readArtifactArray(
  artifact: Record<string, unknown>,
  key: "rootCauseSummaries" | "actionableFindings",
  findingsPath: string,
): unknown[] {
  const value = artifact[key];
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid local review findings in ${findingsPath}: ${key} must be an array.`);
  }

  return value;
}

export async function loadLocalReviewRepairContext(
  summaryPath: string | null,
  workspacePath?: string,
): Promise<LocalReviewRepairContext | null> {
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

  const artifact = parseJson<unknown>(raw, findingsPath);
  if (!isRecord(artifact)) {
    throw new Error(`Invalid local review findings in ${findingsPath}: top-level JSON value must be an object.`);
  }

  const rootCauseSummaries = readArtifactArray(artifact, "rootCauseSummaries", findingsPath);
  const actionableFindings = readArtifactArray(artifact, "actionableFindings", findingsPath);
  const rootCauses = rootCauseSummaries
    .filter(isRecord)
    .filter(hasUsableRootCauseSummary)
    .slice(0, 5)
    .map((rootCause) => {
      const summary = rootCause.summary.trim();
      const start = typeof rootCause.start === "number" ? rootCause.start : null;
      const end = typeof rootCause.end === "number" ? rootCause.end : start;
      return {
        severity: isRootCauseSeverity(rootCause.severity) ? rootCause.severity : "medium",
        summary,
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
    ...actionableFindings
      .filter(isRecord)
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
