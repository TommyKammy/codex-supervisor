import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  CadenceDiagnosticsSummary,
  LocalCiContractSummary,
  LocalReviewPostureSummary,
  LocalReviewPosturePreset,
  ReleaseReadinessGateSummary,
  SupervisorConfig,
  TrustDiagnosticsSummary,
  WorkspacePreparationContractSummary,
} from "./config-types";
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
        ? "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution."
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

export function summarizeLocalReviewPosture(
  config: Pick<
    SupervisorConfig,
    | "localReviewPosture"
    | "localReviewEnabled"
    | "localReviewPolicy"
    | "localReviewFollowUpIssueCreationEnabled"
    | "localReviewHighSeverityAction"
  >,
): LocalReviewPostureSummary {
  const preset = config.localReviewPosture ?? inferLocalReviewPosturePreset(config);
  const autoRepair = config.localReviewEnabled && config.localReviewHighSeverityAction === "retry"
    ? "high_severity_only"
    : "off";
  const followUpIssueCreation =
    config.localReviewEnabled && config.localReviewFollowUpIssueCreationEnabled === true;
  const summary =
    preset === "off"
      ? "Local review posture is off; local review remains disabled."
      : preset === "advisory"
        ? "Local review posture is advisory; findings are recorded without blocking ready or merge transitions."
        : preset === "repair_high_severity"
          ? "Local review posture repairs verifier-confirmed high-severity findings only."
          : preset === "follow_up_issue_creation"
            ? "Local review posture can create follow-up issues from eligible local-review findings."
            : "Local review posture blocks merge without enabling local-review auto-repair or follow-up issue creation.";

  return {
    preset,
    enabled: config.localReviewEnabled,
    policy: config.localReviewPolicy,
    autoRepair,
    followUpIssueCreation,
    summary,
    guarantees: [
      autoRepair === "off"
        ? "auto-repair stays disabled"
        : "auto-repair is limited to verifier-confirmed high-severity findings",
      followUpIssueCreation
        ? "follow-up issue creation is explicitly enabled"
        : "follow-up issue creation stays disabled",
    ],
  };
}

export function summarizeReleaseReadinessGate(
  config: Pick<SupervisorConfig, "releaseReadinessGate">,
): ReleaseReadinessGateSummary {
  const posture = config.releaseReadinessGate ?? "advisory";
  if (posture === "block_release_publication") {
    return {
      posture: "block_release_publication",
      configured: true,
      canBlock: ["release_publication"],
      cannotBlock: ["pr_publication", "merge_readiness", "loop_operation"],
      summary: "Release readiness gate is configured to block release publication only.",
    };
  }

  return {
    posture: "advisory",
    configured: false,
    canBlock: [],
    cannotBlock: ["pr_publication", "merge_readiness", "loop_operation", "release_publication"],
    summary: "Release readiness checklist is advisory; no release-readiness gate is configured.",
  };
}

function inferLocalReviewPosturePreset(
  config: Pick<
    SupervisorConfig,
    | "localReviewEnabled"
    | "localReviewPolicy"
    | "localReviewFollowUpIssueCreationEnabled"
    | "localReviewHighSeverityAction"
  >,
): LocalReviewPosturePreset {
  if (!config.localReviewEnabled) {
    return "off";
  }
  if (config.localReviewFollowUpIssueCreationEnabled === true) {
    return "follow_up_issue_creation";
  }
  if (config.localReviewHighSeverityAction === "retry") {
    return "repair_high_severity";
  }
  if (config.localReviewPolicy === "advisory") {
    return "advisory";
  }
  return "block_merge";
}

export function summarizeLocalCiContract(
  config: Pick<SupervisorConfig, "localCiCommand" | "workspacePreparationCommand" | "localCiCandidateDismissed"> & { repoPath?: string },
): LocalCiContractSummary {
  const command = displayLocalCiCommand(config.localCiCommand);
  const recommendedCommand = findRepoOwnedLocalCiCandidate(config.repoPath);
  const workspacePreparationCommand = displayLocalCiCommand(config.workspacePreparationCommand);
  const workspacePreparationRecommendedCommand = findRepoOwnedWorkspacePreparationCandidate(config.repoPath);
  type LocalCiAdoptionFlowSummary = NonNullable<LocalCiContractSummary["adoptionFlow"]>;
  const buildAdoptionFlow = (args: {
    state: LocalCiAdoptionFlowSummary["state"];
    validationStatus: LocalCiAdoptionFlowSummary["validationStatus"];
    candidateDetected: boolean;
    commandPreview: string | null;
  }): LocalCiAdoptionFlowSummary => ({
    state: args.state,
    candidateDetected: args.candidateDetected,
    commandPreview: args.commandPreview,
    validationStatus: args.validationStatus,
    workspacePreparationCommand,
    workspacePreparationRecommendedCommand,
    workspacePreparationGuidance: workspacePreparationCommand !== null
      ? `workspacePreparationCommand is configured as ${workspacePreparationCommand}.`
      : workspacePreparationRecommendedCommand !== null
        ? `workspacePreparationCommand is unset. Recommended repo-native preparation command: ${workspacePreparationRecommendedCommand}.`
        : "workspacePreparationCommand is unset; confirm preserved issue worktrees can prepare required toolchains before adopting local CI.",
    decisions: args.state === "candidate_detected" && args.commandPreview !== null
      ? [
        {
          kind: "adopt",
          enabled: true,
          summary: `Save ${args.commandPreview} as localCiCommand.`,
          writes: ["localCiCommand"],
        },
        {
          kind: "dismiss",
          enabled: true,
          summary: "Record localCiCandidateDismissed=true without changing an already configured localCiCommand.",
          writes: ["localCiCandidateDismissed"],
        },
      ]
      : [],
  });
  const warning = buildMissingWorkspacePreparationContractWarning(config);

  if (command !== null) {
    return {
      configured: true,
      command,
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
      warning,
      adoptionFlow: buildAdoptionFlow({
        state: "configured",
        validationStatus: "configured",
        candidateDetected: recommendedCommand !== null,
        commandPreview: command,
      }),
    };
  }

  if (recommendedCommand !== null && config.localCiCandidateDismissed === true) {
    return {
      configured: false,
      command: null,
      recommendedCommand,
      source: "dismissed_repo_script_candidate",
      summary:
        `Repo-owned local CI candidate was intentionally dismissed; localCiCommand remains unset and non-blocking. Dismissed candidate: ${recommendedCommand}.`,
      warning: null,
      adoptionFlow: buildAdoptionFlow({
        state: "dismissed",
        validationStatus: "dismissed",
        candidateDetected: true,
        commandPreview: recommendedCommand,
      }),
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
      adoptionFlow: buildAdoptionFlow({
        state: "candidate_detected",
        validationStatus: "not_run",
        candidateDetected: true,
        commandPreview: recommendedCommand,
      }),
    };
  }

  return {
    configured: false,
    command: null,
    recommendedCommand: null,
    source: "config",
    summary: "No repo-owned local CI contract is configured.",
    warning: null,
    adoptionFlow: buildAdoptionFlow({
      state: "not_available",
      validationStatus: "not_available",
      candidateDetected: false,
      commandPreview: null,
    }),
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
