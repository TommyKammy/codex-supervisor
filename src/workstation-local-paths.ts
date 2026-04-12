import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_EXCLUDED_PATHS = [
  "docs/examples/atlaspm.supervisor.config.example.json",
  "docs/examples/atlaspm.md",
  "src/backend/webui-dashboard.test.ts",
  "src/index.test.ts",
] as const;

const UNIX_HOME_PREFIX = `/${"home"}/`;
const MACOS_USERS_PREFIX = `/${"Users"}/`;
const WINDOWS_PATH_SEPARATOR = String.fromCharCode(92);
const WINDOWS_USERS_PREFIX = `C:${WINDOWS_PATH_SEPARATOR}${"Users"}${WINDOWS_PATH_SEPARATOR}`;
const PATH_TOKEN_PATTERN = String.raw`[^\s"'` + "`" + String.raw`<>]+`;
const COMPOUND_PATH_SEPARATORS = new Set([":", ";"]);
const ABSOLUTE_PATH_PREFIXES = [UNIX_HOME_PREFIX, MACOS_USERS_PREFIX, WINDOWS_USERS_PREFIX] as const;
// Keep this allowlist intentionally short so container defaults stop tripping the gate
// without weakening workstation-home detection for typical developer paths.
const KNOWN_CONTAINER_HOME_OWNERS = new Set(["node"]);
const UNIX_HOME_OWNER_PATTERN = new RegExp(`^${escapeForRegex(UNIX_HOME_PREFIX)}([^/]+)(?:/|$)`);

export interface WorkstationLocalPathClassification {
  blocked: boolean;
  label: string;
  reason: string;
}

const CANDIDATE_PATTERNS: ReadonlyArray<{
  regex: RegExp;
  classify: (candidate: string) => WorkstationLocalPathClassification | null;
}> = [
  {
    regex: new RegExp(`${escapeForRegex(UNIX_HOME_PREFIX)}${PATH_TOKEN_PATTERN}`, "g"),
    classify: classifyWorkstationLocalPathCandidate,
  },
  {
    regex: new RegExp(`${escapeForRegex(MACOS_USERS_PREFIX)}${PATH_TOKEN_PATTERN}`, "g"),
    classify: classifyWorkstationLocalPathCandidate,
  },
  {
    regex: new RegExp(`${escapeForRegex(WINDOWS_USERS_PREFIX)}${PATH_TOKEN_PATTERN}`, "g"),
    classify: classifyWorkstationLocalPathCandidate,
  },
];

export interface WorkstationLocalPathMatch {
  filePath: string;
  line: number;
  match: string;
  prefix: string;
  reason: string;
}

export function formatWorkstationLocalPathMatch(finding: WorkstationLocalPathMatch): string {
  return `- ${finding.filePath}:${finding.line} matched ${finding.prefix} (${finding.reason}) via ${JSON.stringify(finding.match)}`;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function normalizeRepoRelativePath(filePath: string): string {
  const slashNormalized = filePath.replace(/\\/g, "/");
  return path.posix.normalize(slashNormalized).replace(/^(?:\.\/)+/, "");
}

function extractUnixHomeOwner(candidate: string): string | null {
  const match = candidate.match(UNIX_HOME_OWNER_PATTERN);
  return match?.[1] ?? null;
}

export function classifyWorkstationLocalPathCandidate(candidate: string): WorkstationLocalPathClassification | null {
  if (candidate.startsWith(MACOS_USERS_PREFIX)) {
    return {
      blocked: true,
      label: "/Users/<user>/",
      reason: "macOS user home directory",
    };
  }

  if (candidate.startsWith(WINDOWS_USERS_PREFIX)) {
    return {
      blocked: true,
      label: "C:\\Users\\<user>\\",
      reason: "Windows user home directory",
    };
  }

  if (!candidate.startsWith(UNIX_HOME_PREFIX)) {
    return null;
  }

  const owner = extractUnixHomeOwner(candidate);
  if (!owner) {
    return null;
  }

  if (KNOWN_CONTAINER_HOME_OWNERS.has(owner.toLowerCase())) {
    return {
      blocked: false,
      label: `${UNIX_HOME_PREFIX}${owner}/`,
      reason: `allowed known container home owner "${owner}"`,
    };
  }

  return {
    blocked: true,
    label: "/home/<user>/",
    reason: "Linux user home directory",
  };
}

function gitTrackedFiles(workspacePath: string): string[] {
  const result = spawnSync("git", ["-C", workspacePath, "ls-files", "-z"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ls-files failed for ${workspacePath}`);
  }

  return result.stdout
    .split("\0")
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizeRepoRelativePath(entry));
}

function isBinary(contents: Buffer): boolean {
  return contents.includes(0);
}

function startsWithAbsolutePathPrefix(candidate: string, index: number): boolean {
  return ABSOLUTE_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix, index));
}

function splitCompoundCandidate(candidate: string): string[] {
  const parts: string[] = [];
  let segmentStart = 0;

  for (let index = 1; index < candidate.length; index += 1) {
    const separator = candidate[index - 1];
    if (!COMPOUND_PATH_SEPARATORS.has(separator)) {
      continue;
    }

    if (!startsWithAbsolutePathPrefix(candidate, index)) {
      continue;
    }

    parts.push(candidate.slice(segmentStart, index - 1));
    segmentStart = index;
  }

  parts.push(candidate.slice(segmentStart));
  return parts.filter((part) => part.length > 0);
}

function collectMatches(filePath: string, contents: string): WorkstationLocalPathMatch[] {
  const matches: WorkstationLocalPathMatch[] = [];
  const seen = new Set<string>();
  const lines = contents.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const pattern of CANDIDATE_PATTERNS) {
      pattern.regex.lastIndex = 0;
      for (const match of line.matchAll(pattern.regex)) {
        for (const candidate of splitCompoundCandidate(match[0])) {
          const classification = pattern.classify(candidate);
          if (!classification?.blocked) {
            continue;
          }

          const findingKey = `${lineIndex + 1}\0${candidate}\0${classification.label}`;
          if (seen.has(findingKey)) {
            continue;
          }
          seen.add(findingKey);

          matches.push({
            filePath,
            line: lineIndex + 1,
            match: candidate,
            prefix: classification.label,
            reason: classification.reason,
          });
        }
      }
    }
  }

  return matches;
}

export async function findForbiddenWorkstationLocalPaths(
  workspacePath: string,
  excludedPaths: Iterable<string> = DEFAULT_EXCLUDED_PATHS,
): Promise<WorkstationLocalPathMatch[]> {
  const trackedFiles = gitTrackedFiles(workspacePath);
  const normalizedExcludedPaths = new Set([...excludedPaths].map((entry) => normalizeRepoRelativePath(entry)));
  const findings: WorkstationLocalPathMatch[] = [];

  for (const filePath of trackedFiles) {
    if (normalizedExcludedPaths.has(filePath)) {
      continue;
    }

    const absolutePath = path.join(workspacePath, filePath);
    let rawContents: Buffer;
    try {
      rawContents = await fs.readFile(absolutePath);
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code === "ENOENT") {
        continue;
      }

      throw error;
    }
    if (isBinary(rawContents)) {
      continue;
    }

    findings.push(...collectMatches(filePath, rawContents.toString("utf8")));
  }

  return findings;
}
