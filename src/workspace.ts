import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./command";
import { SupervisorConfig, WorkspaceStatus } from "./types";
import { ensureDir } from "./utils";

export function branchNameForIssue(config: SupervisorConfig, issueNumber: number): string {
  return `${config.branchPrefix}${issueNumber}`;
}

export function workspacePathForIssue(config: SupervisorConfig, issueNumber: number): string {
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

export async function ensureWorkspace(
  config: SupervisorConfig,
  issueNumber: number,
  branch: string,
): Promise<string> {
  const workspacePath = workspacePathForIssue(config, issueNumber);
  await ensureDir(config.workspaceRoot);
  await runCommand("git", ["-C", config.repoPath, "fetch", "origin", config.defaultBranch]);

  if (fs.existsSync(path.join(workspacePath, ".git"))) {
    return workspacePath;
  }

  if (fs.existsSync(workspacePath) && !fs.existsSync(path.join(workspacePath, ".git"))) {
    throw new Error(`Workspace path exists but is not a git worktree: ${workspacePath}`);
  }

  if (await branchExists(config.repoPath, branch)) {
    await runCommand("git", ["-C", config.repoPath, "worktree", "add", workspacePath, branch]);
    return workspacePath;
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

  return workspacePath;
}

export async function getWorkspaceStatus(
  workspacePath: string,
  branch: string,
  defaultBranch: string,
): Promise<WorkspaceStatus> {
  const [headResult, branchResult, statusResult, baseResult, remoteExistsResult] = await Promise.all([
    runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"]),
    runCommand("git", ["-C", workspacePath, "rev-parse", "--abbrev-ref", "HEAD"]),
    runCommand("git", ["-C", workspacePath, "status", "--short"]),
    runCommand("git", ["-C", workspacePath, "rev-list", "--left-right", "--count", `origin/${defaultBranch}...HEAD`]),
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
      await runCommand("git", ["-C", workspacePath, "fetch", "origin", `${branch}:refs/remotes/origin/${branch}`]);
    }

    const remoteResult = await runCommand("git", [
      "-C",
      workspacePath,
      "rev-list",
      "--left-right",
      "--count",
      `origin/${branch}...HEAD`,
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
