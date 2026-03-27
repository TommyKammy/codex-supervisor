import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_EXCLUDED_PATHS = [
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

interface Args {
  workspacePath: string;
  excludedPaths: Set<string>;
}

interface MatchRecord {
  filePath: string;
  line: number;
  match: string;
  prefix: string;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function usage(): string {
  return [
    "Usage: tsx scripts/check-workstation-local-paths.ts [--workspace <path>] [--exclude-path <repo-relative-path>]",
    "",
    `Scans tracked durable text artifacts for workstation-local absolute paths such as ${UNIX_HOME_PREFIX}, ${MACOS_USERS_PREFIX}, and ${WINDOWS_USERS_PREFIX}.`,
    "Approved committed fixtures/examples must be exempted intentionally by repo-relative path via --exclude-path",
    `or by extending DEFAULT_EXCLUDED_PATHS in ${path.posix.join("scripts", "check-workstation-local-paths.ts")}.`,
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const excludedPaths = new Set<string>(DEFAULT_EXCLUDED_PATHS);
  let workspacePath = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--workspace") {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for --workspace\n\n${usage()}`);
      }
      workspacePath = path.resolve(argv[index]);
      continue;
    }

    if (token === "--exclude-path") {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for --exclude-path\n\n${usage()}`);
      }
      excludedPaths.add(normalizeRepoRelativePath(argv[index]));
      continue;
    }

    if (token === "--help" || token === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
  }

  return {
    workspacePath,
    excludedPaths,
  };
}

function normalizeRepoRelativePath(filePath: string): string {
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

function collectMatches(filePath: string, contents: string): MatchRecord[] {
  const matches: MatchRecord[] = [];
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

async function findForbiddenPaths(workspacePath: string, excludedPaths: Set<string>): Promise<MatchRecord[]> {
  const trackedFiles = gitTrackedFiles(workspacePath);
  const findings: MatchRecord[] = [];

  for (const filePath of trackedFiles) {
    if (excludedPaths.has(filePath)) {
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

async function main(): Promise<void> {
  const { workspacePath, excludedPaths } = parseArgs(process.argv.slice(2));
  const findings = await findForbiddenPaths(workspacePath, excludedPaths);

  if (findings.length === 0) {
    console.log(`No forbidden workstation-local absolute paths found in tracked durable artifacts under ${workspacePath}.`);
    return;
  }

  const renderedFindings = findings
    .map((finding) => `- ${finding.filePath}:${finding.line} matched ${finding.prefix} via ${JSON.stringify(finding.match)}`)
    .join("\n");
  const renderedExclusions = [...excludedPaths].sort().map((entry) => `- ${entry}`).join("\n");

  throw new Error(
    [
      "Forbidden workstation-local absolute path references found:",
      renderedFindings,
      "",
      "If a tracked fixture/example is intentionally committed with one of these paths, exempt it explicitly with --exclude-path",
      `or extend DEFAULT_EXCLUDED_PATHS in ${path.posix.join("scripts", "check-workstation-local-paths.ts")}.`,
      "",
      "Active excluded paths:",
      renderedExclusions,
    ].join("\n"),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
