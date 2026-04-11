import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./command";
import { EnsuredWorkspace, SupervisorConfig, WorkspaceRestoreMetadata, WorkspaceStatus } from "./types";
import { ensureDir, isValidGitRefName } from "./utils";

const LIVE_ISSUE_JOURNAL_PATH_GLOB = ".codex-supervisor/issues/[0-9]*/issue-journal.md";
const LIVE_ISSUE_JOURNAL_PATH_REGEX = /^\.codex-supervisor\/issues\/\d+\/issue-journal\.md$/u;

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

async function gitRefExists(gitPath: string, ref: string): Promise<boolean> {
  const result = await runCommand(
    "git",
    ["-C", gitPath, "show-ref", "--verify", "--quiet", ref],
    { allowExitCodes: [0, 1] },
  );
  return result.exitCode === 0;
}

async function listDefaultBranchCandidateRefs(repoPath: string, defaultBranch: string): Promise<string[]> {
  const candidates = new Set<string>();
  const localRef = `refs/heads/${defaultBranch}`;
  if (await gitRefExists(repoPath, localRef)) {
    candidates.add(defaultBranch);
  }

  const remotes = await runCommand("git", ["-C", repoPath, "remote"]);
  for (const remote of remotes.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
    const remoteRef = `refs/remotes/${remote}/${defaultBranch}`;
    if (await gitRefExists(repoPath, remoteRef)) {
      candidates.add(`${remote}/${defaultBranch}`);
    }
  }

  return [...candidates];
}

async function isAncestorRef(repoPath: string, ancestor: string, descendant: string): Promise<boolean> {
  const result = await runCommand(
    "git",
    ["-C", repoPath, "merge-base", "--is-ancestor", ancestor, descendant],
    { allowExitCodes: [0, 1] },
  );
  return result.exitCode === 0;
}

async function revParse(repoPath: string, ref: string): Promise<string> {
  const result = await runCommand("git", ["-C", repoPath, "rev-parse", ref]);
  return result.stdout.trim();
}

function preferredBootstrapBaseRef(defaultBranch: string, refs: string[]): string {
  const preferredOrder = [`origin/${defaultBranch}`, defaultBranch];
  for (const preferredRef of preferredOrder) {
    if (refs.includes(preferredRef)) {
      return preferredRef;
    }
  }

  return [...refs].sort()[0] ?? `origin/${defaultBranch}`;
}

async function resolveBootstrapBaseRef(repoPath: string, defaultBranch: string): Promise<string> {
  const candidateRefs = await listDefaultBranchCandidateRefs(repoPath, defaultBranch);
  if (candidateRefs.length === 0) {
    throw new Error(`No available default-branch refs found for ${defaultBranch}`);
  }

  const remoteCandidateRefs = candidateRefs.filter((ref) => ref !== defaultBranch);
  const refsToCompare = remoteCandidateRefs.length > 0 ? remoteCandidateRefs : candidateRefs;
  const candidateShas = new Map<string, string>();
  for (const ref of refsToCompare) {
    candidateShas.set(ref, await revParse(repoPath, ref));
  }

  const maximalRefs: string[] = [];
  for (const candidateRef of refsToCompare) {
    let containsAllOthers = true;
    for (const otherRef of refsToCompare) {
      if (candidateRef === otherRef) {
        continue;
      }
      if (!(await isAncestorRef(repoPath, otherRef, candidateRef))) {
        containsAllOthers = false;
        break;
      }
    }
    if (containsAllOthers) {
      maximalRefs.push(candidateRef);
    }
  }

  if (maximalRefs.length === 0) {
    throw new Error(
      `Could not determine an authoritative default-branch ref for ${defaultBranch}; candidates diverged: ${refsToCompare.join(", ")}`,
    );
  }

  const maximalShas = new Set(maximalRefs.map((ref) => candidateShas.get(ref)));
  if (maximalShas.size > 1) {
    throw new Error(
      `Could not determine an authoritative default-branch ref for ${defaultBranch}; candidates diverged: ${maximalRefs.join(", ")}`,
    );
  }

  return preferredBootstrapBaseRef(defaultBranch, maximalRefs);
}

async function originBranchExists(gitPath: string, branch: string): Promise<boolean> {
  const result = await runCommand(
    "git",
    ["-C", gitPath, "ls-remote", "--exit-code", "--heads", "origin", branch],
    { allowExitCodes: [0, 2] },
  );
  return result.exitCode === 0;
}

async function fetchIssueRemoteTrackingRef(repoPath: string, branch: string): Promise<boolean> {
  const remoteRef = `refs/remotes/origin/${branch}`;
  if (!(await originBranchExists(repoPath, branch))) {
    await runCommand(
      "git",
      ["-C", repoPath, "update-ref", "-d", remoteRef],
      { allowExitCodes: [0, 1] },
    );
    return false;
  }

  await runCommand("git", ["-C", repoPath, "fetch", "origin", `+refs/heads/${branch}:${remoteRef}`]);
  return true;
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

async function protectTrackedLiveIssueJournals(workspacePath: string): Promise<void> {
  const trackedPathsResult = await runCommand(
    "git",
    ["-C", workspacePath, "ls-files", "-z", "--", LIVE_ISSUE_JOURNAL_PATH_GLOB],
  );
  const trackedPaths = trackedPathsResult.stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => LIVE_ISSUE_JOURNAL_PATH_REGEX.test(entry));

  if (trackedPaths.length === 0) {
    return;
  }

  await runCommand("git", ["-C", workspacePath, "update-index", "--skip-worktree", "--", ...trackedPaths]);
}

export function formatWorkspaceRestoreStatusLine(restore: WorkspaceRestoreMetadata): string {
  return `workspace_restore source=${restore.source} ref=${restore.ref}`;
}

interface GitWorktreeEntry {
  worktreePath: string;
  branchRef: string | null;
}

function parseGitWorktreeList(stdout: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }
      current = {
        worktreePath: path.resolve(line.slice("worktree ".length).trim()),
        branchRef: null,
      };
      continue;
    }

    if (line.startsWith("branch ") && current) {
      current.branchRef = line.slice("branch ".length).trim();
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

async function assertReusableExistingWorkspace(
  config: Pick<SupervisorConfig, "repoPath">,
  workspacePath: string,
  branch: string,
): Promise<void> {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const worktreeList = await runCommand("git", ["-C", config.repoPath, "worktree", "list", "--porcelain"]);
  const worktreeEntry = parseGitWorktreeList(worktreeList.stdout).find(
    (entry) => entry.worktreePath === resolvedWorkspacePath,
  );

  if (!worktreeEntry) {
    throw new Error(`Existing workspace is not a registered worktree for repository ${config.repoPath}: ${workspacePath}`);
  }

  const headBranch = await runCommand(
    "git",
    ["-C", workspacePath, "symbolic-ref", "--quiet", "--short", "HEAD"],
    { allowExitCodes: [0, 1] },
  );
  if (headBranch.exitCode !== 0) {
    throw new Error(`Existing workspace is on a detached HEAD; expected branch ${branch}: ${workspacePath}`);
  }

  const actualBranch = headBranch.stdout.trim();
  if (actualBranch !== branch) {
    throw new Error(`Existing workspace is on branch ${actualBranch}; expected branch ${branch}: ${workspacePath}`);
  }

  if (worktreeEntry.branchRef !== `refs/heads/${branch}`) {
    throw new Error(
      `Existing workspace worktree metadata points at ${worktreeEntry.branchRef ?? "detached HEAD"}; expected refs/heads/${branch}: ${workspacePath}`,
    );
  }
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
    await assertReusableExistingWorkspace(config, workspacePath, branch);
    await protectTrackedLiveIssueJournals(workspacePath);
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
    await protectTrackedLiveIssueJournals(workspacePath);
    return buildEnsuredWorkspace(workspacePath, {
      source: "local_branch",
      ref: branch,
    });
  }

  if (remoteBranchExists) {
    await runCommand("git", ["-C", config.repoPath, "worktree", "add", "-b", branch, workspacePath, `origin/${branch}`]);
    await protectTrackedLiveIssueJournals(workspacePath);
    return buildEnsuredWorkspace(workspacePath, {
      source: "remote_branch",
      ref: `origin/${branch}`,
    });
  }

  const bootstrapBaseRef = await resolveBootstrapBaseRef(config.repoPath, config.defaultBranch);
  await runCommand("git", [
    "-C",
    config.repoPath,
    "worktree",
    "add",
    "-b",
    branch,
    workspacePath,
    bootstrapBaseRef,
  ]);
  await protectTrackedLiveIssueJournals(workspacePath);

  return buildEnsuredWorkspace(workspacePath, {
    source: "bootstrap_default_branch",
    ref: bootstrapBaseRef,
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

export async function commitAndPushTrackedFiles(args: {
  workspacePath: string;
  branch: string;
  remoteBranchExists: boolean;
  filePaths: string[];
  commitMessage: string;
}): Promise<boolean> {
  const filePaths = [...new Set(args.filePaths.map((filePath) => filePath.trim()).filter(Boolean))];
  if (filePaths.length === 0) {
    return false;
  }

  await runCommand("git", ["-C", args.workspacePath, "add", "--", ...filePaths]);
  const stagedDiff = await runCommand(
    "git",
    ["-C", args.workspacePath, "diff", "--cached", "--quiet", "--exit-code", "--", ...filePaths],
    { allowExitCodes: [0, 1] },
  );
  if (stagedDiff.exitCode === 0) {
    return false;
  }

  await runCommand("git", ["-C", args.workspacePath, "commit", "-m", args.commitMessage, "--", ...filePaths]);
  await pushBranch(args.workspacePath, args.branch, args.remoteBranchExists);
  return true;
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
