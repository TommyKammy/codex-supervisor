import fs from "node:fs";
import path from "node:path";

export type GitStatusPorcelainV1Entry = {
  statusCode: string;
  paths: string[];
};

export function isIgnoredSupervisorArtifactPath(
  relativePath: string,
  journalRelativePath: string,
): boolean {
  return relativePath === journalRelativePath
    || relativePath === ".codex-supervisor/turn-in-progress.json"
    || relativePath === ".codex-supervisor/replay"
    || relativePath.startsWith(".codex-supervisor/replay/")
    || relativePath === ".codex-supervisor/pre-merge"
    || relativePath.startsWith(".codex-supervisor/pre-merge/")
    || relativePath === ".codex-supervisor/execution-metrics"
    || relativePath.startsWith(".codex-supervisor/execution-metrics/");
}

export function parseGitStatusPorcelainV1Entries(statusOutput: string): GitStatusPorcelainV1Entry[] {
  const fields = statusOutput.split("\0");
  const entries: GitStatusPorcelainV1Entry[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.length < 4) {
      continue;
    }

    const statusCode = field.slice(0, 2);
    const paths = [field.slice(3)].filter((entry) => entry.length > 0);
    if (statusCode.includes("R") || statusCode.includes("C")) {
      const pairedPath = fields[index + 1] ?? "";
      if (pairedPath.length > 0) {
        paths.push(pairedPath);
        index += 1;
      }
    }

    if (paths.length > 0) {
      entries.push({
        statusCode,
        paths,
      });
    }
  }

  return entries;
}

export function parseGitStatusPorcelainV1Paths(statusOutput: string): string[][] {
  return parseGitStatusPorcelainV1Entries(statusOutput).map((entry) => entry.paths);
}

export function normalizeGitPath(targetPath: string): string {
  try {
    return fs.realpathSync.native?.(targetPath) ?? fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function parseGitWorktreePaths(stdout: string): Set<string> {
  const worktreePaths = new Set<string>();

  for (const rawLine of stdout.split("\n")) {
    if (!rawLine.startsWith("worktree ")) {
      continue;
    }

    worktreePaths.add(normalizeGitPath(rawLine.slice("worktree ".length).trim()));
  }

  return worktreePaths;
}
