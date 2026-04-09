import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./core/command";
import { inspectFileLock } from "./core/lock";
import { type IssueRunRecord, type SupervisorConfig, type SupervisorStateFile } from "./core/types";
import { hoursSince } from "./core/utils";
import { branchNameForIssue, cleanupWorkspace, isSafeCleanupTarget } from "./core/workspace";
import { type RecoveryEvent } from "./run-once-cycle-prelude";
import {
  type PrunedOrphanedWorkspaceResultDto,
  type SkippedOrphanedWorkspaceResultDto,
  type SupervisorOrphanPruneResultDto,
} from "./supervisor/supervisor-mutation-report";

export type OrphanedWorkspacePruneEligibility = "eligible" | "locked" | "recent" | "unsafe_target";

export interface OrphanedWorkspacePruneCandidate {
  issueNumber: number;
  workspaceName: string;
  workspacePath: string;
  branch: string | null;
  eligibility: OrphanedWorkspacePruneEligibility;
  reason: string;
  modifiedAt: string | null;
}

interface InspectOrphanedWorkspacePruneCandidatesOptions {
  now?: Date;
}

function orphanedWorkspaceGracePeriodHours(config: SupervisorConfig): number {
  const gracePeriodHours = config.cleanupOrphanedWorkspacesAfterHours ?? 24;
  if (!Number.isFinite(gracePeriodHours) || gracePeriodHours < 0) {
    throw new Error("Invalid config field: cleanupOrphanedWorkspacesAfterHours");
  }

  return gracePeriodHours;
}

function updateLatestModifiedMs(currentModifiedMs: number, candidateModifiedMs: number): number {
  if (Number.isNaN(currentModifiedMs) || candidateModifiedMs > currentModifiedMs) {
    return candidateModifiedMs;
  }

  return currentModifiedMs;
}

function readExistingAncestorModifiedMs(candidatePath: string, workspaceRootPath: string): number | null {
  let existingAncestorPath = path.dirname(candidatePath);

  while (
    existingAncestorPath === workspaceRootPath
    || existingAncestorPath.startsWith(`${workspaceRootPath}${path.sep}`)
  ) {
    try {
      return fs.statSync(existingAncestorPath).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return null;
      }

      const parentPath = path.dirname(existingAncestorPath);
      if (parentPath === existingAncestorPath) {
        return null;
      }
      existingAncestorPath = parentPath;
    }
  }

  return null;
}

async function readOrphanedWorkspaceActivityTimestamp(workspacePath: string): Promise<string | null> {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  let latestModifiedMs = Number.NaN;
  try {
    latestModifiedMs = fs.statSync(resolvedWorkspacePath).mtimeMs;
  } catch {
    latestModifiedMs = Number.NaN;
  }

  try {
    const [unstagedResult, stagedResult] = await Promise.all([
      runCommand(
        "git",
        ["-C", workspacePath, "ls-files", "--modified", "--others", "--exclude-standard", "-z"],
      ),
      runCommand("git", ["-C", workspacePath, "diff", "--name-only", "--cached", "-z"]),
    ]);
    const dirtyPaths = new Set(
      `${unstagedResult.stdout}${stagedResult.stdout}`
        .split("\0")
        .filter((relativePath) => relativePath.length > 0),
    );

    for (const relativePath of dirtyPaths) {
      const candidatePath = path.resolve(resolvedWorkspacePath, relativePath);
      if (!candidatePath.startsWith(`${resolvedWorkspacePath}${path.sep}`)) {
        continue;
      }

      try {
        latestModifiedMs = updateLatestModifiedMs(latestModifiedMs, fs.statSync(candidatePath).mtimeMs);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          continue;
        }

        const ancestorModifiedMs = readExistingAncestorModifiedMs(candidatePath, resolvedWorkspacePath);
        if (ancestorModifiedMs !== null) {
          latestModifiedMs = updateLatestModifiedMs(latestModifiedMs, ancestorModifiedMs);
        }
      }
    }
  } catch {
    // Fall back to the workspace directory timestamp if git cannot report dirty paths.
  }

  if (Number.isNaN(latestModifiedMs)) {
    return null;
  }

  return new Date(latestModifiedMs).toISOString();
}

function parseIssueNumberFromWorkspaceName(workspaceName: string): number | null {
  const match = /^issue-([1-9]\d*)$/.exec(workspaceName);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

async function cleanupRecordWorkspace(config: SupervisorConfig, record: IssueRunRecord): Promise<boolean> {
  if (!isSafeCleanupTarget(config, record.workspace, record.branch)) {
    console.warn(
      `Skipped unsafe cleanup target workspace=${record.workspace} branch=${record.branch} for issue #${record.issue_number}.`,
    );
    return false;
  }

  await cleanupWorkspace(config.repoPath, record.workspace, record.branch);
  return true;
}

export async function inspectOrphanedWorkspacePruneCandidates(
  config: SupervisorConfig,
  state: SupervisorStateFile,
  options: InspectOrphanedWorkspacePruneCandidatesOptions = {},
): Promise<OrphanedWorkspacePruneCandidate[]> {
  const gracePeriodHours = orphanedWorkspaceGracePeriodHours(config);
  const referencedWorkspaces = new Set(
    Object.values(state.issues).map((record) => path.resolve(record.workspace)),
  );
  const candidates: OrphanedWorkspacePruneCandidate[] = [];
  const now = options.now ?? new Date();
  let workspaceEntries: fs.Dirent[];
  try {
    workspaceEntries = fs.readdirSync(config.workspaceRoot, { withFileTypes: true });
  } catch {
    return candidates;
  }

  for (const entry of workspaceEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const issueNumber = parseIssueNumberFromWorkspaceName(entry.name);
    if (issueNumber === null) {
      continue;
    }

    const workspacePath = path.join(config.workspaceRoot, entry.name);
    if (referencedWorkspaces.has(path.resolve(workspacePath))) {
      continue;
    }

    if (!fs.existsSync(path.join(workspacePath, ".git"))) {
      continue;
    }

    const modifiedAt = await readOrphanedWorkspaceActivityTimestamp(workspacePath);

    let branch: string | null = null;
    try {
      branch = branchNameForIssue(config, issueNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      candidates.push({
        issueNumber,
        workspaceName: entry.name,
        workspacePath,
        branch: null,
        eligibility: "unsafe_target",
        reason: message,
        modifiedAt,
      });
      continue;
    }

    if (!isSafeCleanupTarget(config, workspacePath, branch)) {
      candidates.push({
        issueNumber,
        workspaceName: entry.name,
        workspacePath,
        branch,
        eligibility: "unsafe_target",
        reason: "unsafe cleanup target",
        modifiedAt,
      });
      continue;
    }

    const issueLockPath = path.join(path.dirname(config.stateFile), "locks", "issues", `issue-${issueNumber}.lock`);
    const issueLock = await inspectFileLock(issueLockPath);
    if (issueLock.status === "live" || issueLock.status === "ambiguous_owner") {
      candidates.push({
        issueNumber,
        workspaceName: entry.name,
        workspacePath,
        branch,
        eligibility: "locked",
        reason: issueLock.status === "live"
          ? `issue lock held by pid ${issueLock.payload?.pid ?? "unknown"}`
          : `issue lock has ambiguous owner metadata for pid ${issueLock.payload?.pid ?? "unknown"}`,
        modifiedAt,
      });
      continue;
    }

    if (modifiedAt) {
      const ageMs = now.getTime() - Date.parse(modifiedAt);
      if (ageMs >= 0 && ageMs < gracePeriodHours * 60 * 60 * 1000) {
        candidates.push({
          issueNumber,
          workspaceName: entry.name,
          workspacePath,
          branch,
          eligibility: "recent",
          reason: `workspace modified within ${gracePeriodHours}h grace period`,
          modifiedAt,
        });
        continue;
      }
    }

    candidates.push({
      issueNumber,
      workspaceName: entry.name,
      workspacePath,
      branch,
      eligibility: "eligible",
      reason: "safe orphaned git worktree",
      modifiedAt,
    });
  }

  candidates.sort((left, right) => left.issueNumber - right.issueNumber || left.workspaceName.localeCompare(right.workspaceName));
  return candidates;
}

export async function pruneOrphanedWorkspacesForOperator(
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<SupervisorOrphanPruneResultDto> {
  const candidates = await inspectOrphanedWorkspacePruneCandidates(config, state);
  const pruned: PrunedOrphanedWorkspaceResultDto[] = [];
  const skipped: SkippedOrphanedWorkspaceResultDto[] = [];

  for (const candidate of candidates) {
    if (candidate.eligibility === "eligible" && candidate.branch) {
      await cleanupWorkspace(config.repoPath, candidate.workspacePath, candidate.branch);
      pruned.push({
        issueNumber: candidate.issueNumber,
        workspaceName: candidate.workspaceName,
        workspacePath: candidate.workspacePath,
        branch: candidate.branch,
        modifiedAt: candidate.modifiedAt,
        reason: candidate.reason,
      });
      continue;
    }

    if (candidate.eligibility === "eligible") {
      skipped.push({
        issueNumber: candidate.issueNumber,
        workspaceName: candidate.workspaceName,
        workspacePath: candidate.workspacePath,
        branch: candidate.branch,
        modifiedAt: candidate.modifiedAt,
        eligibility: "unsafe_target",
        reason: candidate.reason,
      });
      continue;
    }

    skipped.push({
      issueNumber: candidate.issueNumber,
      workspaceName: candidate.workspaceName,
      workspacePath: candidate.workspacePath,
      branch: candidate.branch,
      modifiedAt: candidate.modifiedAt,
      eligibility: candidate.eligibility,
      reason: candidate.reason,
    });
  }

  return {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: `Pruned ${pruned.length} orphaned workspace(s); skipped ${skipped.length} orphaned workspace(s).`,
    pruned,
    skipped,
  };
}

export async function cleanupExpiredDoneWorkspaces(
  config: SupervisorConfig,
  state: SupervisorStateFile,
  buildRecoveryEvent: (issueNumber: number, reason: string) => RecoveryEvent,
): Promise<RecoveryEvent[]> {
  if (config.cleanupDoneWorkspacesAfterHours < 0 && config.maxDoneWorkspaces < 0) {
    return [];
  }

  const recoveryEvents: RecoveryEvent[] = [];
  const doneRecords = Object.values(state.issues)
    .filter((record) => record.state === "done")
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at));

  const existingDoneRecords = doneRecords.filter((record) =>
    fs.existsSync(path.join(record.workspace, ".git")),
  );

  const cleanedWorkspacePaths = new Set<string>();

  if (config.maxDoneWorkspaces >= 0 && existingDoneRecords.length > config.maxDoneWorkspaces) {
    const overflowCount = existingDoneRecords.length - config.maxDoneWorkspaces;
    const overflowRecords = existingDoneRecords.slice(0, overflowCount);
    for (const record of overflowRecords) {
      if (await cleanupRecordWorkspace(config, record)) {
        recoveryEvents.push(buildRecoveryEvent(
          record.issue_number,
          `done_workspace_cleanup: removed tracked done workspace for issue #${record.issue_number}`,
        ));
      }
      cleanedWorkspacePaths.add(record.workspace);
    }
  }

  if (config.cleanupDoneWorkspacesAfterHours < 0) {
    return recoveryEvents;
  }

  for (const record of doneRecords) {
    if (cleanedWorkspacePaths.has(record.workspace)) {
      continue;
    }

    if (hoursSince(record.updated_at) < config.cleanupDoneWorkspacesAfterHours) {
      continue;
    }

    if (await cleanupRecordWorkspace(config, record)) {
      recoveryEvents.push(buildRecoveryEvent(
        record.issue_number,
        `done_workspace_cleanup: removed tracked done workspace for issue #${record.issue_number}`,
      ));
    }
  }

  return recoveryEvents;
}
