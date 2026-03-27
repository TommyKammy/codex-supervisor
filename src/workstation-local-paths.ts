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

const FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  { label: UNIX_HOME_PREFIX, regex: new RegExp(`${escapeForRegex(UNIX_HOME_PREFIX)}${PATH_TOKEN_PATTERN}`, "g") },
  { label: MACOS_USERS_PREFIX, regex: new RegExp(`${escapeForRegex(MACOS_USERS_PREFIX)}${PATH_TOKEN_PATTERN}`, "g") },
  { label: WINDOWS_USERS_PREFIX, regex: new RegExp(`${escapeForRegex(WINDOWS_USERS_PREFIX)}${PATH_TOKEN_PATTERN}`, "g") },
];

export interface WorkstationLocalPathMatch {
  filePath: string;
  line: number;
  match: string;
  prefix: string;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function normalizeRepoRelativePath(filePath: string): string {
  const slashNormalized = filePath.replace(/\\/g, "/");
  return path.posix.normalize(slashNormalized).replace(/^(?:\.\/)+/, "");
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

function collectMatches(filePath: string, contents: string): WorkstationLocalPathMatch[] {
  const matches: WorkstationLocalPathMatch[] = [];
  const lines = contents.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.regex.lastIndex = 0;
      for (const match of line.matchAll(pattern.regex)) {
        matches.push({
          filePath,
          line: lineIndex + 1,
          match: match[0],
          prefix: pattern.label,
        });
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
    const rawContents = await fs.readFile(absolutePath);
    if (isBinary(rawContents)) {
      continue;
    }

    findings.push(...collectMatches(filePath, rawContents.toString("utf8")));
  }

  return findings;
}
