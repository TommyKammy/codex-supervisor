import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  CadenceDiagnosticsSummary,
  LocalCiContractSummary,
  SupervisorConfig,
  TrustDiagnosticsSummary,
  WorkspacePreparationContractSummary,
} from "./types";
import { parseJson } from "./utils";
import {
  DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW,
  LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
  LOCAL_CI_SCRIPT_CANDIDATES,
  PREFERRED_ISSUE_JOURNAL_RELATIVE_PATH,
  WORKSPACE_PREPARATION_LOCKFILE_CANDIDATES,
} from "./config-constants";
import { displayLocalCiCommand } from "./config-parsing";
import {
  buildMissingWorkspacePreparationContractWarning,
  validateWorkspacePreparationCommandForWorktrees,
} from "./config-validation";

export {
  DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW,
  LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
  PREFERRED_ISSUE_JOURNAL_RELATIVE_PATH,
};

export function summarizeTrustDiagnostics(
  config: Pick<SupervisorConfig, "trustMode" | "executionSafetyMode" | "issueJournalRelativePath">,
): TrustDiagnosticsSummary {
  const trustMode = config.trustMode ?? "trusted_repo_and_authors";
  const executionSafetyMode = config.executionSafetyMode ?? "unsandboxed_autonomous";
  const issueJournalRelativePath = config.issueJournalRelativePath.trim();

  return {
    trustMode,
    executionSafetyMode,
    warning:
      trustMode === "trusted_repo_and_authors" && executionSafetyMode === "unsandboxed_autonomous"
        ? "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs."
        : null,
    configWarning:
      issueJournalRelativePath === LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH
        ? `Active config still uses legacy shared issue journal path ${LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH}; prefer ${PREFERRED_ISSUE_JOURNAL_RELATIVE_PATH}.`
        : null,
  };
}

export function summarizeCadenceDiagnostics(
  config: Pick<SupervisorConfig, "pollIntervalSeconds" | "mergeCriticalRecheckSeconds">,
): CadenceDiagnosticsSummary {
  const mergeCriticalRecheckSeconds =
    typeof config.mergeCriticalRecheckSeconds === "number" &&
    Number.isFinite(config.mergeCriticalRecheckSeconds) &&
    Number.isInteger(config.mergeCriticalRecheckSeconds) &&
    config.mergeCriticalRecheckSeconds > 0
      ? config.mergeCriticalRecheckSeconds
      : null;

  return {
    pollIntervalSeconds: config.pollIntervalSeconds,
    mergeCriticalRecheckSeconds,
    mergeCriticalEffectiveSeconds: mergeCriticalRecheckSeconds ?? config.pollIntervalSeconds,
    mergeCriticalRecheckEnabled: mergeCriticalRecheckSeconds !== null,
  };
}

export function summarizeLocalCiContract(
  config: Pick<SupervisorConfig, "localCiCommand" | "workspacePreparationCommand"> & { repoPath?: string },
): LocalCiContractSummary {
  const command = displayLocalCiCommand(config.localCiCommand);
  const recommendedCommand = findRepoOwnedLocalCiCandidate(config.repoPath);
  const warning = buildMissingWorkspacePreparationContractWarning(config);

  if (command !== null) {
    return {
      configured: true,
      command,
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
      warning,
    };
  }

  if (recommendedCommand !== null) {
    return {
      configured: false,
      command: null,
      recommendedCommand,
      source: "repo_script_candidate",
      summary: `Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: ${recommendedCommand}.`,
      warning: null,
    };
  }

  return {
    configured: false,
    command: null,
    recommendedCommand: null,
    source: "config",
    summary: "No repo-owned local CI contract is configured.",
    warning: null,
  };
}

export function summarizeWorkspacePreparationContract(
  config: Pick<SupervisorConfig, "workspacePreparationCommand" | "localCiCommand"> & { repoPath?: string },
): WorkspacePreparationContractSummary {
  const command = displayLocalCiCommand(config.workspacePreparationCommand);
  const warning = buildMissingWorkspacePreparationContractWarning(config);
  const recommendedCommand = findRepoOwnedWorkspacePreparationCandidate(config.repoPath);
  if (command !== null) {
    return {
      configured: true,
      command,
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned workspace preparation contract is configured.",
      warning: validateWorkspacePreparationCommandForWorktrees(config),
    };
  }

  return {
    configured: false,
    command: null,
    recommendedCommand,
    source: "config",
    summary:
      recommendedCommand === null
        ? "No repo-owned workspace preparation contract is configured."
        : `No repo-owned workspace preparation contract is configured. Recommended command: ${recommendedCommand}.`,
    warning,
  };
}

function findRepoOwnedLocalCiCandidate(repoPath: string | undefined): string | null {
  if (typeof repoPath !== "string" || repoPath.trim() === "") {
    return null;
  }

  const packageJsonPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = parseJson<Record<string, unknown>>(fs.readFileSync(packageJsonPath, "utf8"), packageJsonPath);
    const scripts =
      packageJson.scripts && typeof packageJson.scripts === "object" && !Array.isArray(packageJson.scripts)
        ? packageJson.scripts as Record<string, unknown>
        : null;
    if (scripts === null) {
      return null;
    }

    for (const scriptName of LOCAL_CI_SCRIPT_CANDIDATES) {
      const scriptCommand = scripts[scriptName];
      if (typeof scriptCommand === "string" && scriptCommand.trim() !== "") {
        return `npm run ${scriptName}`;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function findRepoOwnedWorkspacePreparationCandidate(repoPath: string | undefined): string | null {
  if (typeof repoPath !== "string" || repoPath.trim() === "") {
    return null;
  }

  for (const candidate of WORKSPACE_PREPARATION_LOCKFILE_CANDIDATES) {
    const candidatePath = path.join(repoPath, candidate.file);
    if (!isTrackedRepoFile(repoPath, candidate.file) || !isFilePath(candidatePath)) {
      continue;
    }

    return candidate.command;
  }

  return null;
}

function isFilePath(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isTrackedRepoFile(repoPath: string, repoRelativePath: string): boolean {
  const trackedCheck = spawnSync("git", ["-C", repoPath, "ls-files", "--error-unmatch", "--", repoRelativePath], {
    encoding: "utf8",
  });

  return trackedCheck.status === 0;
}
