import { truncate } from "./core/utils";

const CODEX_TURN_VERIFICATION_COMMAND_NAMES = [
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "deno",
  "tsx",
  "tsc",
  "ts-node",
  "jest",
  "vitest",
  "mocha",
  "playwright",
  "pytest",
  "python",
  "python3",
  "uv",
  "go",
  "cargo",
  "make",
  "cmake",
  "mvn",
  "gradle",
  "bash",
  "sh",
  "zsh",
  "ruby",
  "bundle",
  "rspec",
  "eslint",
  "prettier",
  "ruff",
  "mypy",
  "rtk",
  "gh",
  "git",
].join("|");
const CODEX_TURN_VERIFICATION_COMMAND_PATTERN = new RegExp(
  `^(?:[\\\`$]\\s*)?(?:(?:${CODEX_TURN_VERIFICATION_COMMAND_NAMES})\\b|(?:\\.{0,2}/))`,
  "i",
);

function hasExplicitCodexTurnVerificationCommandEvidence(value: string): boolean {
  return codexTurnVerificationCommandEntries(value)
    .some((candidate) => CODEX_TURN_VERIFICATION_COMMAND_PATTERN.test(candidate));
}

function normalizeCodexTurnVerificationCommandEntry(value: string): string {
  return value
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^\$\s*/u, "")
    .trim();
}

function codexTurnVerificationCommandEntries(value: string | null | undefined): string[] {
  const normalized = normalizeCodexTurnVerificationCommandEntry(value ?? "");
  if (!normalized) {
    return [];
  }
  const splitEntries = normalized
    .split(/[\n;]+/)
    .map(normalizeCodexTurnVerificationCommandEntry)
    .filter((candidate) => candidate.length > 0);
  return [...new Set([normalized, ...splitEntries])];
}

function verificationCommandComparisonVariants(value: string): string[] {
  const normalized = normalizeCodexTurnVerificationCommandEntry(value);
  const withoutRtk = normalized.replace(/^rtk\s+/u, "").trim();
  return [...new Set([normalized, withoutRtk].filter((candidate) => candidate.length > 0))];
}

export function codexTurnVerificationIncludesCommand(
  tests: string | null | undefined,
  expectedCommand: string | null | undefined,
): boolean {
  const expected = expectedCommand?.trim();
  if (!expected) {
    return false;
  }
  const expectedCommands = new Set(verificationCommandComparisonVariants(expected));
  return codexTurnVerificationCommandEntries(tests)
    .flatMap(verificationCommandComparisonVariants)
    .some((candidate) => expectedCommands.has(candidate));
}

function hasExplicitNegativeCodexTurnVerificationOutcome(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized === "not run" ||
    normalized === "none" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized.includes("not run") ||
    normalized.includes("no tests") ||
    normalized.includes("stale head") ||
    normalized.includes("ambiguous") ||
    normalized.includes("unclear") ||
    normalized.includes("?")
  ) {
    return true;
  }
  return /(?:^|\s)(?:failed|failure|error|timeout|blocked|skipped)(?=$|[\s:.,;])/i.test(
    value,
  );
}

function hasExplicitFailedCodexTurnVerificationOutcome(value: string): boolean {
  return /(?:^|\s)(?:failed|failure|error|timeout|blocked)(?=$|[\s:.,;])/i.test(
    value,
  );
}

export function explicitPassingCodexTurnVerificationCommand(
  tests: string | null | undefined,
): string | null {
  const value = tests?.trim();
  if (!value) {
    return null;
  }
  if (hasExplicitNegativeCodexTurnVerificationOutcome(value)) {
    return null;
  }
  if (!hasExplicitCodexTurnVerificationCommandEvidence(value)) {
    return null;
  }
  return value;
}

export function explicitFailedCodexTurnVerificationCommand(
  tests: string | null | undefined,
): string | null {
  const value = tests?.trim();
  if (!value) {
    return null;
  }
  if (!hasExplicitCodexTurnVerificationCommandEvidence(value)) {
    return null;
  }
  if (!hasExplicitFailedCodexTurnVerificationOutcome(value)) {
    return null;
  }
  return value;
}

export function conciseCodexVerificationSummary(summary: string | null | undefined): string {
  const value = summary?.trim();
  return truncate(value && value.length > 0 ? value : "Codex turn verification passed.", 500) ??
    "Codex turn verification passed.";
}

export function conciseFailedCodexVerificationSummary(summary: string | null | undefined): string {
  const value = summary?.trim();
  return truncate(value && value.length > 0 ? value : "Codex turn verification failed.", 500) ??
    "Codex turn verification failed.";
}
