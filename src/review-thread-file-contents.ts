import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewThread } from "./core/types";
import { getWorkspaceStatus } from "./core/workspace";

export type RepositoryFileContents = Record<string, string | null | undefined>;

const execFileAsync = promisify(execFile);
const MAX_REPAIR_PROBE_FILE_BYTES = 512_000;

function normalizeReviewThreadPath(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\\/g, "/").replace(/^\.\/+/u, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").includes("..")) {
    return null;
  }
  return normalized;
}

async function readCommittedRepositoryFile(args: {
  workspacePath: string;
  expectedHeadSha: string;
  relativePath: string;
}): Promise<string | null> {
  const objectSpec = `${args.expectedHeadSha}:${args.relativePath}`;
  const treeEntry = await execFileAsync(
    "git",
    ["-C", args.workspacePath, "ls-tree", "-z", args.expectedHeadSha, "--", args.relativePath],
    { encoding: "utf8", maxBuffer: 64_000 },
  );
  const entry = treeEntry.stdout.split("\0").find((line) => line.endsWith(`\t${args.relativePath}`));
  if (!entry) {
    return null;
  }

  const mode = entry.match(/^(\d{6})\s/u)?.[1] ?? null;
  if (mode === "120000" || (mode !== "100644" && mode !== "100755")) {
    return null;
  }

  const sizeResult = await execFileAsync(
    "git",
    ["-C", args.workspacePath, "cat-file", "-s", objectSpec],
    { encoding: "utf8", maxBuffer: 64_000 },
  );
  const size = Number.parseInt(sizeResult.stdout.trim(), 10);
  if (!Number.isFinite(size) || size > MAX_REPAIR_PROBE_FILE_BYTES) {
    return null;
  }

  const blobResult = await execFileAsync(
    "git",
    ["-C", args.workspacePath, "show", objectSpec],
    { encoding: "utf8", maxBuffer: MAX_REPAIR_PROBE_FILE_BYTES + 1024 },
  );
  return blobResult.stdout;
}

export async function loadReviewThreadFileContents(args: {
  defaultBranch: string;
  expectedHeadSha: string;
  branch: string;
  workspacePath?: string | null;
  reviewThreads: ReviewThread[];
}): Promise<RepositoryFileContents | undefined> {
  if (!args.workspacePath) {
    return undefined;
  }

  try {
    const workspaceStatus = await getWorkspaceStatus(args.workspacePath, args.branch, args.defaultBranch);
    if (workspaceStatus.headSha !== args.expectedHeadSha || workspaceStatus.hasUncommittedChanges) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const workspaceRoot = path.resolve(args.workspacePath);
  const contents: RepositoryFileContents = {};
  const paths = Array.from(
    new Set(args.reviewThreads.flatMap((thread) => {
      const normalized = normalizeReviewThreadPath(thread.path);
      return normalized ? [normalized] : [];
    })),
  ).slice(0, 20);

  for (const relativePath of paths) {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
      continue;
    }
    try {
      const committedContent = await readCommittedRepositoryFile({
        workspacePath: workspaceRoot,
        expectedHeadSha: args.expectedHeadSha,
        relativePath,
      });
      if (committedContent === null) {
        continue;
      }
      contents[relativePath] = committedContent;
    } catch {
      contents[relativePath] = null;
    }
  }

  return Object.keys(contents).length > 0 ? contents : undefined;
}
