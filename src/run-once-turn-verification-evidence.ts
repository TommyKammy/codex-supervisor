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

function codexTurnVerificationCommandEntries(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\n;]+/)
    .map((candidate) => candidate.trim().replace(/^`+|`+$/g, "").trim())
    .filter((candidate) => candidate.length > 0);
}

function normalizeVerificationCommandForComparison(value: string): string {
  return value
    .replace(/^\$\s*/u, "")
    .replace(/^rtk\s+/u, "")
    .trim();
}

export function codexTurnVerificationIncludesCommand(
  tests: string | null | undefined,
  expectedCommand: string | null | undefined,
): boolean {
  const expected = expectedCommand?.trim();
  if (!expected) {
    return false;
  }
  return codexTurnVerificationCommandEntries(tests)
    .map(normalizeVerificationCommandForComparison)
    .some((candidate) => candidate === expected);
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
