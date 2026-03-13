import fs from "node:fs/promises";
import path from "node:path";
import { parseJson } from "./utils";
import { legacyReusableMissPatterns } from "./external-review-miss-patterns";
import { type ExternalReviewMissFinding } from "./external-review-classifier";
import {
  type DurableExternalReviewGuardrails,
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

const DURABLE_EXTERNAL_REVIEW_GUARDRAILS_PATH = path.join(
  "docs",
  "shared-memory",
  "external-review-guardrails.json",
);
const DURABLE_EXTERNAL_REVIEW_GUARDRAILS_VERSION = 1;
const DURABLE_EXTERNAL_REVIEW_GUARDRAILS_MAX_BYTES = 256 * 1024;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function compareMissPatternPriority(left: ExternalReviewMissPattern, right: ExternalReviewMissPattern): number {
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

  const fingerprintComparison = left.fingerprint.localeCompare(right.fingerprint);
  if (fingerprintComparison !== 0) {
    return fingerprintComparison;
  }

  const headShaComparison = left.sourceHeadSha.localeCompare(right.sourceHeadSha);
  if (headShaComparison !== 0) {
    return headShaComparison;
  }

  return left.sourceArtifactPath.localeCompare(right.sourceArtifactPath);
}

function validateDurableMissPattern(value: unknown, source: string, index: number): ExternalReviewMissPattern {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}] must be an object.`);
  }

  const pattern = value as Record<string, unknown>;
  if (!isNonEmptyString(pattern.fingerprint)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].fingerprint must be a non-empty string.`);
  }
  if (!isNonEmptyString(pattern.reviewerLogin)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].reviewerLogin must be a non-empty string.`);
  }
  if (!isNonEmptyString(pattern.file)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].file must be a non-empty string.`);
  }
  if (!isNullableNumber(pattern.line)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].line must be a number or null.`);
  }
  if (!isNonEmptyString(pattern.summary)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].summary must be a non-empty string.`);
  }
  if (!isNonEmptyString(pattern.rationale)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].rationale must be a non-empty string.`);
  }
  if (!isNonEmptyString(pattern.sourceArtifactPath)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].sourceArtifactPath must be a non-empty string.`);
  }
  if (!isNonEmptyString(pattern.sourceHeadSha)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].sourceHeadSha must be a non-empty string.`);
  }
  if (!isNonEmptyString(pattern.lastSeenAt)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].lastSeenAt must be a non-empty string.`);
  }

  return {
    fingerprint: pattern.fingerprint,
    reviewerLogin: pattern.reviewerLogin,
    file: pattern.file,
    line: pattern.line,
    summary: pattern.summary,
    rationale: pattern.rationale,
    sourceArtifactPath: pattern.sourceArtifactPath,
    sourceHeadSha: pattern.sourceHeadSha,
    lastSeenAt: pattern.lastSeenAt,
  };
}

async function loadDurableExternalReviewGuardrails(workspacePath: string): Promise<ExternalReviewMissPattern[]> {
  const guardrailPath = path.join(workspacePath, DURABLE_EXTERNAL_REVIEW_GUARDRAILS_PATH);
  let stat;
  try {
    stat = await fs.stat(guardrailPath);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  if (stat.size === 0) {
    return [];
  }
  if (stat.size > DURABLE_EXTERNAL_REVIEW_GUARDRAILS_MAX_BYTES) {
    throw new Error(
      `Durable external review guardrails at ${guardrailPath} exceed ${DURABLE_EXTERNAL_REVIEW_GUARDRAILS_MAX_BYTES} bytes.`,
    );
  }

  const raw = await fs.readFile(guardrailPath, "utf8");
  if (raw.trim() === "") {
    return [];
  }

  const parsed = parseJson<DurableExternalReviewGuardrails & { version?: unknown; patterns?: unknown }>(raw, guardrailPath);
  if (parsed.version !== DURABLE_EXTERNAL_REVIEW_GUARDRAILS_VERSION) {
    throw new Error(
      `Invalid durable external review guardrails in ${guardrailPath}: version must be ${DURABLE_EXTERNAL_REVIEW_GUARDRAILS_VERSION}.`,
    );
  }
  if (!Array.isArray(parsed.patterns)) {
    throw new Error(`Invalid durable external review guardrails in ${guardrailPath}: patterns must be an array.`);
  }

  return parsed.patterns.map((pattern, index) => validateDurableMissPattern(pattern, guardrailPath, index));
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
    if (!existing || compareMissPatternPriority(pattern, existing) < 0) {
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
    mergeRelevantPatterns(deduped, await loadDurableExternalReviewGuardrails(args.workspacePath), changedFileSet);
  }

  let entries: string[];
  try {
    entries = await fs.readdir(args.artifactDir);
  } catch {
    return [...deduped.values()]
      .sort(compareMissPatternPriority)
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
    .sort(compareMissPatternPriority)
    .slice(0, Math.max(0, args.limit ?? 3));
}
