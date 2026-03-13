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
const DURABLE_MISS_PATTERN_KEYS = [
  "fingerprint",
  "reviewerLogin",
  "file",
  "line",
  "summary",
  "rationale",
  "sourceArtifactPath",
  "sourceHeadSha",
  "lastSeenAt",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeRequiredString(
  value: unknown,
  source: string,
  index: number,
  field: (typeof DURABLE_MISS_PATTERN_KEYS)[number],
): string {
  if (!isNonEmptyString(value)) {
    throw new Error(
      `Invalid durable external review guardrails in ${source}: patterns[${index}].${field} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1);
}

function isIso8601Timestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }

  const timestampMs = Date.parse(value);
  return !Number.isNaN(timestampMs);
}

function assertNoUnexpectedPatternFields(pattern: Record<string, unknown>, source: string, index: number): void {
  const allowedKeys = new Set<string>(DURABLE_MISS_PATTERN_KEYS);
  for (const key of Object.keys(pattern)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].${key} is not allowed.`);
    }
  }
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
  assertNoUnexpectedPatternFields(pattern, source, index);

  if (!isPositiveIntegerOrNull(pattern.line)) {
    throw new Error(
      `Invalid durable external review guardrails in ${source}: patterns[${index}].line must be an integer >= 1 or null.`,
    );
  }

  const lastSeenAt = normalizeRequiredString(pattern.lastSeenAt, source, index, "lastSeenAt");
  if (!isIso8601Timestamp(lastSeenAt)) {
    throw new Error(
      `Invalid durable external review guardrails in ${source}: patterns[${index}].lastSeenAt must be an ISO-8601 timestamp.`,
    );
  }

  return {
    fingerprint: normalizeRequiredString(pattern.fingerprint, source, index, "fingerprint"),
    reviewerLogin: normalizeRequiredString(pattern.reviewerLogin, source, index, "reviewerLogin"),
    file: normalizeRequiredString(pattern.file, source, index, "file"),
    line: pattern.line,
    summary: normalizeRequiredString(pattern.summary, source, index, "summary"),
    rationale: normalizeRequiredString(pattern.rationale, source, index, "rationale"),
    sourceArtifactPath: normalizeRequiredString(pattern.sourceArtifactPath, source, index, "sourceArtifactPath"),
    sourceHeadSha: normalizeRequiredString(pattern.sourceHeadSha, source, index, "sourceHeadSha"),
    lastSeenAt,
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
  for (const key of Object.keys(parsed)) {
    if (key !== "version" && key !== "patterns") {
      throw new Error(`Invalid durable external review guardrails in ${guardrailPath}: ${key} is not allowed.`);
    }
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
