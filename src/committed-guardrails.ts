import fs from "node:fs/promises";
import path from "node:path";
import {
  type DurableExternalReviewGuardrails,
  type ExternalReviewMissPattern,
} from "./external-review/external-review-miss-artifact-types";
import { parseJson, writeJsonAtomic } from "./core/utils";
import { type VerifierGuardrailRule } from "./verifier-guardrails";

interface DurableVerifierGuardrails {
  version: 1;
  rules: VerifierGuardrailRule[];
}

interface FormattedGuardrailFile<TDocument> {
  path: string;
  document: TDocument;
  contents: string;
  updated: boolean;
}

interface FormattedCommittedGuardrails {
  verifier: FormattedGuardrailFile<DurableVerifierGuardrails>;
  externalReview: FormattedGuardrailFile<DurableExternalReviewGuardrails>;
}

export const VERIFIER_GUARDRAILS_PATH = path.join("docs", "shared-memory", "verifier-guardrails.json");
export const EXTERNAL_REVIEW_GUARDRAILS_PATH = path.join("docs", "shared-memory", "external-review-guardrails.json");
export const VERIFIER_GUARDRAILS_SCHEMA_VERSION = 1;
export const EXTERNAL_REVIEW_GUARDRAILS_SCHEMA_VERSION = 1;
const GUARDRAILS_MAX_BYTES = 256 * 1024;
const VERIFIER_GUARDRAIL_KEYS = ["id", "title", "file", "line", "summary", "rationale"] as const;
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

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1;
}

function normalizeRequiredString(value: unknown, message: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(message);
  }

  return value.trim();
}

function isIso8601Timestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function validateSchemaVersion(
  actualVersion: unknown,
  expectedVersion: number,
  source: string,
  label: string,
): void {
  if (actualVersion === undefined) {
    throw new Error(`Invalid ${label} in ${source}: missing schema version; expected version ${expectedVersion}.`);
  }

  if (!isPositiveInteger(actualVersion)) {
    throw new Error(
      `Invalid ${label} in ${source}: schema version must be a positive integer; expected version ${expectedVersion}.`,
    );
  }

  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Invalid ${label} in ${source}: unsupported schema version ${actualVersion}; expected version ${expectedVersion}.`,
    );
  }
}

export function compareVerifierGuardrails(left: VerifierGuardrailRule, right: VerifierGuardrailRule): number {
  const fileComparison = left.file.localeCompare(right.file);
  if (fileComparison !== 0) {
    return fileComparison;
  }

  const lineComparison = (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
  if (lineComparison !== 0) {
    return lineComparison;
  }

  const titleComparison = left.title.localeCompare(right.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.id.localeCompare(right.id);
}

export function compareExternalReviewPatterns(left: ExternalReviewMissPattern, right: ExternalReviewMissPattern): number {
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

function validateVerifierGuardrailRule(value: unknown, source: string, index: number): VerifierGuardrailRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid verifier guardrails in ${source}: rules[${index}] must be an object.`);
  }

  const rule = value as Record<string, unknown>;
  for (const key of Object.keys(rule)) {
    if (!VERIFIER_GUARDRAIL_KEYS.includes(key as (typeof VERIFIER_GUARDRAIL_KEYS)[number])) {
      throw new Error(`Invalid verifier guardrails in ${source}: rules[${index}].${key} is not allowed.`);
    }
  }

  if (!isPositiveIntegerOrNull(rule.line)) {
    throw new Error(`Invalid verifier guardrails in ${source}: rules[${index}].line must be an integer >= 1 or null.`);
  }

  return {
    id: normalizeRequiredString(
      rule.id,
      `Invalid verifier guardrails in ${source}: rules[${index}].id must be a non-empty string.`,
    ),
    title: normalizeRequiredString(
      rule.title,
      `Invalid verifier guardrails in ${source}: rules[${index}].title must be a non-empty string.`,
    ),
    file: normalizeRequiredString(
      rule.file,
      `Invalid verifier guardrails in ${source}: rules[${index}].file must be a non-empty string.`,
    ),
    line: rule.line,
    summary: normalizeRequiredString(
      rule.summary,
      `Invalid verifier guardrails in ${source}: rules[${index}].summary must be a non-empty string.`,
    ),
    rationale: normalizeRequiredString(
      rule.rationale,
      `Invalid verifier guardrails in ${source}: rules[${index}].rationale must be a non-empty string.`,
    ),
  };
}

function validateExternalReviewPattern(value: unknown, source: string, index: number): ExternalReviewMissPattern {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}] must be an object.`);
  }

  const pattern = value as Record<string, unknown>;
  for (const key of Object.keys(pattern)) {
    if (!DURABLE_MISS_PATTERN_KEYS.includes(key as (typeof DURABLE_MISS_PATTERN_KEYS)[number])) {
      throw new Error(`Invalid durable external review guardrails in ${source}: patterns[${index}].${key} is not allowed.`);
    }
  }

  if (!isPositiveIntegerOrNull(pattern.line)) {
    throw new Error(
      `Invalid durable external review guardrails in ${source}: patterns[${index}].line must be an integer >= 1 or null.`,
    );
  }

  const lastSeenAt = normalizeRequiredString(
    pattern.lastSeenAt,
    `Invalid durable external review guardrails in ${source}: patterns[${index}].lastSeenAt must be a non-empty string.`,
  );
  if (!isIso8601Timestamp(lastSeenAt)) {
    throw new Error(
      `Invalid durable external review guardrails in ${source}: patterns[${index}].lastSeenAt must be an ISO-8601 timestamp.`,
    );
  }

  return {
    fingerprint: normalizeRequiredString(
      pattern.fingerprint,
      `Invalid durable external review guardrails in ${source}: patterns[${index}].fingerprint must be a non-empty string.`,
    ),
    reviewerLogin: normalizeRequiredString(
      pattern.reviewerLogin,
      `Invalid durable external review guardrails in ${source}: patterns[${index}].reviewerLogin must be a non-empty string.`,
    ),
    file: normalizeRequiredString(
      pattern.file,
      `Invalid durable external review guardrails in ${source}: patterns[${index}].file must be a non-empty string.`,
    ),
    line: pattern.line,
    summary: normalizeRequiredString(
      pattern.summary,
      `Invalid durable external review guardrails in ${source}: patterns[${index}].summary must be a non-empty string.`,
    ),
    rationale: normalizeRequiredString(
      pattern.rationale,
      `Invalid durable external review guardrails in ${source}: patterns[${index}].rationale must be a non-empty string.`,
    ),
    sourceArtifactPath: normalizeRequiredString(
      pattern.sourceArtifactPath,
      `Invalid durable external review guardrails in ${source}: patterns[${index}].sourceArtifactPath must be a non-empty string.`,
    ),
    sourceHeadSha: normalizeRequiredString(
      pattern.sourceHeadSha,
      `Invalid durable external review guardrails in ${source}: patterns[${index}].sourceHeadSha must be a non-empty string.`,
    ),
    lastSeenAt,
  };
}

function assertUniqueVerifierIds(rules: VerifierGuardrailRule[], source: string): void {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    if (seen.has(rule.id)) {
      throw new Error(`Duplicate verifier guardrail id "${rule.id}" in ${source} at rules[${index}].`);
    }

    seen.add(rule.id);
  });
}

function assertUniqueExternalReviewFingerprints(patterns: ExternalReviewMissPattern[], source: string): void {
  const seen = new Set<string>();
  patterns.forEach((pattern, index) => {
    if (seen.has(pattern.fingerprint)) {
      throw new Error(
        `Duplicate durable external review fingerprint "${pattern.fingerprint}" in ${source} at patterns[${index}].`,
      );
    }

    seen.add(pattern.fingerprint);
  });
}

function parseVerifierGuardrails(raw: string, source: string): DurableVerifierGuardrails {
  if (raw.trim() === "") {
    return { version: 1, rules: [] };
  }

  const parsed = parseJson<DurableVerifierGuardrails & { version?: unknown; rules?: unknown }>(raw, source);
  validateSchemaVersion(parsed.version, VERIFIER_GUARDRAILS_SCHEMA_VERSION, source, "verifier guardrails");
  for (const key of Object.keys(parsed)) {
    if (key !== "version" && key !== "rules") {
      throw new Error(`Invalid verifier guardrails in ${source}: ${key} is not allowed.`);
    }
  }
  if (!Array.isArray(parsed.rules)) {
    throw new Error(`Invalid verifier guardrails in ${source}: rules must be an array.`);
  }

  const rules = parsed.rules.map((rule, index) => validateVerifierGuardrailRule(rule, source, index));
  assertUniqueVerifierIds(rules, source);
  return { version: 1, rules };
}

function parseExternalReviewGuardrails(raw: string, source: string): DurableExternalReviewGuardrails {
  if (raw.trim() === "") {
    return { version: 1, patterns: [] };
  }

  const parsed = parseJson<DurableExternalReviewGuardrails & { version?: unknown; patterns?: unknown }>(raw, source);
  validateSchemaVersion(
    parsed.version,
    EXTERNAL_REVIEW_GUARDRAILS_SCHEMA_VERSION,
    source,
    "durable external review guardrails",
  );
  for (const key of Object.keys(parsed)) {
    if (key !== "version" && key !== "patterns") {
      throw new Error(`Invalid durable external review guardrails in ${source}: ${key} is not allowed.`);
    }
  }
  if (!Array.isArray(parsed.patterns)) {
    throw new Error(`Invalid durable external review guardrails in ${source}: patterns must be an array.`);
  }

  const patterns = parsed.patterns.map((pattern, index) => validateExternalReviewPattern(pattern, source, index));
  assertUniqueExternalReviewFingerprints(patterns, source);
  return { version: 1, patterns };
}

async function readGuardrailDocument(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > GUARDRAILS_MAX_BYTES) {
      throw new Error(`Committed guardrails at ${filePath} exceed ${GUARDRAILS_MAX_BYTES} bytes.`);
    }
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return "";
    }

    throw error;
  }

  return await fs.readFile(filePath, "utf8");
}

export async function loadCommittedVerifierGuardrails(workspacePath: string): Promise<VerifierGuardrailRule[]> {
  const guardrailPath = path.join(workspacePath, VERIFIER_GUARDRAILS_PATH);
  const raw = await readGuardrailDocument(guardrailPath);
  return parseVerifierGuardrails(raw, guardrailPath).rules;
}

export async function loadCommittedExternalReviewGuardrails(workspacePath: string): Promise<ExternalReviewMissPattern[]> {
  const guardrailPath = path.join(workspacePath, EXTERNAL_REVIEW_GUARDRAILS_PATH);
  const raw = await readGuardrailDocument(guardrailPath);
  return parseExternalReviewGuardrails(raw, guardrailPath).patterns;
}

export async function validateCommittedGuardrails(workspacePath: string): Promise<void> {
  await formatCommittedGuardrails(workspacePath);
}

export async function formatCommittedGuardrails(workspacePath: string): Promise<FormattedCommittedGuardrails> {
  const verifierPath = path.join(workspacePath, VERIFIER_GUARDRAILS_PATH);
  const externalReviewPath = path.join(workspacePath, EXTERNAL_REVIEW_GUARDRAILS_PATH);
  const verifierRaw = await readGuardrailDocument(verifierPath);
  const verifier = parseVerifierGuardrails(verifierRaw, verifierPath);
  verifier.rules.sort(compareVerifierGuardrails);
  const verifierContents = `${JSON.stringify(verifier, null, 2)}\n`;
  const externalReviewRaw = await readGuardrailDocument(externalReviewPath);
  const externalReview = parseExternalReviewGuardrails(externalReviewRaw, externalReviewPath);
  externalReview.patterns.sort(compareExternalReviewPatterns);
  const externalReviewContents = `${JSON.stringify(externalReview, null, 2)}\n`;

  return {
    verifier: {
      path: verifierPath,
      document: verifier,
      contents: verifierContents,
      updated: verifierRaw !== verifierContents,
    },
    externalReview: {
      path: externalReviewPath,
      document: externalReview,
      contents: externalReviewContents,
      updated: externalReviewRaw !== externalReviewContents,
    },
  };
}

export async function syncCommittedGuardrails(workspacePath: string): Promise<{
  verifierUpdated: boolean;
  externalReviewUpdated: boolean;
}> {
  const formatted = await formatCommittedGuardrails(workspacePath);
  if (formatted.verifier.updated) {
    await writeJsonAtomic(formatted.verifier.path, formatted.verifier.document);
  }
  if (formatted.externalReview.updated) {
    await writeJsonAtomic(formatted.externalReview.path, formatted.externalReview.document);
  }

  return {
    verifierUpdated: formatted.verifier.updated,
    externalReviewUpdated: formatted.externalReview.updated,
  };
}
