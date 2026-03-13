import fs from "node:fs/promises";
import path from "node:path";
import { parseJson } from "./utils";

export interface VerifierGuardrailRule {
  id: string;
  title: string;
  file: string;
  line: number | null;
  summary: string;
  rationale: string;
}

interface DurableVerifierGuardrails {
  version: 1;
  rules: VerifierGuardrailRule[];
}

const VERIFIER_GUARDRAILS_PATH = path.join("docs", "shared-memory", "verifier-guardrails.json");
const VERIFIER_GUARDRAILS_VERSION = 1;
const VERIFIER_GUARDRAILS_MAX_BYTES = 256 * 1024;
const VERIFIER_GUARDRAIL_KEYS = [
  "id",
  "title",
  "file",
  "line",
  "summary",
  "rationale",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeRequiredString(
  value: unknown,
  source: string,
  index: number,
  field: (typeof VERIFIER_GUARDRAIL_KEYS)[number],
): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`Invalid verifier guardrails in ${source}: rules[${index}].${field} must be a non-empty string.`);
  }

  return value.trim();
}

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1);
}

function compareGuardrails(left: VerifierGuardrailRule, right: VerifierGuardrailRule): number {
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

function validateGuardrailRule(value: unknown, source: string, index: number): VerifierGuardrailRule {
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
    id: normalizeRequiredString(rule.id, source, index, "id"),
    title: normalizeRequiredString(rule.title, source, index, "title"),
    file: normalizeRequiredString(rule.file, source, index, "file"),
    line: rule.line,
    summary: normalizeRequiredString(rule.summary, source, index, "summary"),
    rationale: normalizeRequiredString(rule.rationale, source, index, "rationale"),
  };
}

async function loadVerifierGuardrailsFile(workspacePath: string): Promise<VerifierGuardrailRule[]> {
  const guardrailPath = path.join(workspacePath, VERIFIER_GUARDRAILS_PATH);
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
  if (stat.size > VERIFIER_GUARDRAILS_MAX_BYTES) {
    throw new Error(`Verifier guardrails at ${guardrailPath} exceed ${VERIFIER_GUARDRAILS_MAX_BYTES} bytes.`);
  }

  const raw = await fs.readFile(guardrailPath, "utf8");
  if (raw.trim() === "") {
    return [];
  }

  const parsed = parseJson<DurableVerifierGuardrails & { version?: unknown; rules?: unknown }>(raw, guardrailPath);
  if (parsed.version !== VERIFIER_GUARDRAILS_VERSION) {
    throw new Error(`Invalid verifier guardrails in ${guardrailPath}: version must be ${VERIFIER_GUARDRAILS_VERSION}.`);
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "version" && key !== "rules") {
      throw new Error(`Invalid verifier guardrails in ${guardrailPath}: ${key} is not allowed.`);
    }
  }
  if (!Array.isArray(parsed.rules)) {
    throw new Error(`Invalid verifier guardrails in ${guardrailPath}: rules must be an array.`);
  }

  return parsed.rules.map((rule, index) => validateGuardrailRule(rule, guardrailPath, index));
}

export async function loadRelevantVerifierGuardrails(args: {
  workspacePath: string;
  changedFiles: string[];
  limit?: number;
}): Promise<VerifierGuardrailRule[]> {
  const changedFiles = [...new Set(args.changedFiles.filter((filePath) => filePath.trim() !== ""))];
  if (changedFiles.length === 0) {
    return [];
  }

  const changedFileSet = new Set(changedFiles);
  const deduped = new Map<string, VerifierGuardrailRule>();
  for (const rule of await loadVerifierGuardrailsFile(args.workspacePath)) {
    if (!changedFileSet.has(rule.file)) {
      continue;
    }

    if (!deduped.has(rule.id)) {
      deduped.set(rule.id, rule);
    }
  }

  return [...deduped.values()]
    .sort(compareGuardrails)
    .slice(0, Math.max(0, args.limit ?? 3));
}
