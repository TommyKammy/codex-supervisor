import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./command";
import { EnsuredWorkspace, SupervisorConfig, WorkspaceRestoreMetadata, WorkspaceStatus } from "./types";
import { ensureDir, isValidGitRefName } from "./utils";

function assertIssueNumber(issueNumber: number): void {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid issue number: ${issueNumber}`);
  }
}

export function branchNameForIssue(config: SupervisorConfig, issueNumber: number): string {
  assertIssueNumber(issueNumber);
  const branch = `${config.branchPrefix}${issueNumber}`;
  if (!isValidGitRefName(branch)) {
    throw new Error(`Invalid branch name for issue ${issueNumber}: ${branch}`);
  }

  return branch;
}

export function workspacePathForIssue(config: SupervisorConfig, issueNumber: number): string {
  assertIssueNumber(issueNumber);
  return path.join(config.workspaceRoot, `issue-${issueNumber}`);
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const result = await runCommand(
    "git",
    ["-C", repoPath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { allowExitCodes: [0, 1] },
  );
  return result.exitCode === 0;
}

async function remoteTrackingRefExists(gitPath: string, branch: string): Promise<boolean> {
  const result = await runCommand(
    "git",
    ["-C", gitPath, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
    { allowExitCodes: [0, 1] },
  );
  return result.exitCode === 0;
}

async function fetchIssueRemoteTrackingRef(repoPath: string, branch: string): Promise<boolean> {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const result = await runCommand(
    "git",
    ["-C", repoPath, "fetch", "origin", `+refs/heads/${branch}:${remoteRef}`],
    {
      allowExitCodes: [0, 128],
      env: {
        ...process.env,
        LC_ALL: "C",
      },
    },
  );

  if (result.exitCode === 0) {
    return true;
  }

  const missingRemoteRefMessage = `couldn't find remote ref refs/heads/${branch}`;
  if (!result.stderr.includes(missingRemoteRefMessage)) {
    throw new Error(result.stderr.trim() || `git fetch origin ${branch} failed`);
  }

  await runCommand(
    "git",
    ["-C", repoPath, "update-ref", "-d", remoteRef],
    { allowExitCodes: [0, 1] },
  );
  return false;
}

function buildEnsuredWorkspace(
  workspacePath: string,
  restore: WorkspaceRestoreMetadata,
): EnsuredWorkspace {
  return {
    workspacePath,
    restore,
  };
}

export function formatWorkspaceRestoreStatusLine(restore: WorkspaceRestoreMetadata): string {
  return `workspace_restore source=${restore.source} ref=${restore.ref}`;
}

export async function ensureWorkspace(
  config: SupervisorConfig,
  issueNumber: number,
  branch: string,
): Promise<EnsuredWorkspace> {
  assertIssueNumber(issueNumber);
  const workspacePath = workspacePathForIssue(config, issueNumber);
  await ensureDir(config.workspaceRoot);
  await runCommand("git", ["-C", config.repoPath, "fetch", "origin", config.defaultBranch]);
  const remoteBranchExists = await fetchIssueRemoteTrackingRef(config.repoPath, branch);

  if (fs.existsSync(path.join(workspacePath, ".git"))) {
    return buildEnsuredWorkspace(workspacePath, {
      source: "existing_workspace",
      ref: branch,
    });
  }

  if (fs.existsSync(workspacePath) && !fs.existsSync(path.join(workspacePath, ".git"))) {
    throw new Error(`Workspace path exists but is not a git worktree: ${workspacePath}`);
  }

  if (await branchExists(config.repoPath, branch)) {
    await runCommand("git", ["-C", config.repoPath, "worktree", "add", workspacePath, branch]);
    return buildEnsuredWorkspace(workspacePath, {
      source: "local_branch",
      ref: branch,
    });
  }

  if (remoteBranchExists) {
    await runCommand("git", ["-C", config.repoPath, "worktree", "add", "-b", branch, workspacePath, `origin/${branch}`]);
    return buildEnsuredWorkspace(workspacePath, {
      source: "remote_branch",
      ref: `origin/${branch}`,
    });
  }

  await runCommand("git", [
    "-C",
    config.repoPath,
    "worktree",
    "add",
    "-b",
    branch,
    workspacePath,
    `origin/${config.defaultBranch}`,
  ]);

  return buildEnsuredWorkspace(workspacePath, {
    source: "bootstrap_default_branch",
    ref: `origin/${config.defaultBranch}`,
  });
}

export async function getWorkspaceStatus(
  workspacePath: string,
  branch: string,
  defaultBranch: string,
): Promise<WorkspaceStatus> {
  const defaultBranchRef = `refs/remotes/origin/${defaultBranch}`;
  const remoteBranchRef = `refs/remotes/origin/${branch}`;
  const [headResult, branchResult, statusResult, baseResult, remoteExistsResult] = await Promise.all([
    runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"]),
    runCommand("git", ["-C", workspacePath, "rev-parse", "--abbrev-ref", "HEAD"]),
    runCommand("git", ["-C", workspacePath, "status", "--short"]),
    runCommand("git", ["-C", workspacePath, "rev-list", "--left-right", "--count", `${defaultBranchRef}...HEAD`]),
    runCommand(
      "git",
      ["-C", workspacePath, "ls-remote", "--exit-code", "--heads", "origin", branch],
      { allowExitCodes: [0, 2] },
    ),
  ]);

  const [baseBehind, baseAhead] = baseResult.stdout.trim().split(/\s+/).map((value) => Number(value));
  const remoteBranchExists = remoteExistsResult.exitCode === 0;

  let remoteBehind = 0;
  let remoteAhead = 0;
  if (remoteBranchExists) {
    if (!(await remoteTrackingRefExists(workspacePath, branch))) {
      await runCommand("git", ["-C", workspacePath, "fetch", "origin", `${branch}:${remoteBranchRef}`]);
    }

    const remoteResult = await runCommand("git", [
      "-C",
      workspacePath,
      "rev-list",
      "--left-right",
      "--count",
      `${remoteBranchRef}...HEAD`,
    ]);
    [remoteBehind, remoteAhead] = remoteResult.stdout
      .trim()
      .split(/\s+/)
      .map((value) => Number(value));
  }

  return {
    branch: branchResult.stdout.trim(),
    headSha: headResult.stdout.trim(),
    hasUncommittedChanges: statusResult.stdout.trim().length > 0,
    baseAhead: baseAhead || 0,
    baseBehind: baseBehind || 0,
    remoteBranchExists,
    remoteAhead,
    remoteBehind,
  };
}

export async function pushBranch(workspacePath: string, branch: string, remoteBranchExists: boolean): Promise<void> {
  if (remoteBranchExists) {
    await runCommand("git", ["-C", workspacePath, "push", "origin", branch]);
    return;
  }

  await runCommand("git", ["-C", workspacePath, "push", "-u", "origin", branch]);
}

export async function cleanupWorkspace(
  repoPath: string,
  workspacePath: string,
  branch: string,
): Promise<void> {
  if (fs.existsSync(path.join(workspacePath, ".git"))) {
    await runCommand(
      "git",
      ["-C", repoPath, "worktree", "remove", "--force", workspacePath],
      { allowExitCodes: [0, 128] },
    );
  }

  await runCommand("git", ["-C", repoPath, "worktree", "prune"], { allowExitCodes: [0] });
  await runCommand(
    "git",
    ["-C", repoPath, "branch", "-D", branch],
    { allowExitCodes: [0, 1] },
  );
}

export function isSafeCleanupTarget(
  config: Pick<SupervisorConfig, "workspaceRoot" | "branchPrefix">,
  workspacePath: string,
  branch: string,
): boolean {
  const resolvedRoot = path.resolve(config.workspaceRoot);
  const resolvedWorkspace = path.resolve(workspacePath);
  const relativeWorkspace = path.relative(resolvedRoot, resolvedWorkspace);

  if (
    relativeWorkspace === "" ||
    relativeWorkspace.startsWith("..") ||
    path.isAbsolute(relativeWorkspace) ||
    !relativeWorkspace.startsWith("issue-")
  ) {
    return false;
  }

  return branch.startsWith(config.branchPrefix) && isValidGitRefName(branch);
}
