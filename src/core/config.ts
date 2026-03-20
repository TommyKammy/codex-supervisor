import fs from "node:fs";
import path from "node:path";
import {
  CopilotReviewTimeoutAction,
  LocalReviewHighSeverityAction,
  LocalReviewPolicy,
  LocalReviewReviewerThresholdConfig,
  LocalReviewReviewerType,
  ReasoningEffort,
  RunState,
  SupervisorConfig,
} from "./types";
import { mapConfiguredReviewProviders } from "./review-providers";
import { isValidGitRefName, parseJson, resolveMaybeRelative } from "./utils";

const DEFAULT_CONFIG_FILE = "supervisor.config.json";
const REQUIRED_STRING_CONFIG_FIELDS = [
  "repoPath",
  "repoSlug",
  "defaultBranch",
  "workspaceRoot",
  "stateFile",
  "codexBinary",
  "branchPrefix",
] as const;

export type ConfigLoadStatus = "ready" | "missing_config" | "invalid_config";

export interface ConfigLoadSummary {
  configPath: string;
  status: ConfigLoadStatus;
  missingRequiredFields: string[];
  invalidFields: string[];
  error: string | null;
  config: SupervisorConfig | null;
}

function resolveCommandLikeValue(baseDir: string, value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return /[\\/]/.test(value) ? resolveMaybeRelative(baseDir, value) : value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid config field: ${label}`);
  }

  return value;
}

function assertPattern(value: string, label: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new Error(`Invalid config field: ${label}`);
  }

  return value;
}

function assertGitRefName(value: string, label: string): string {
  if (!isValidGitRefName(value)) {
    throw new Error(`Invalid config field: ${label}`);
  }

  return value;
}

function assertBranchPrefix(value: string, label: string): string {
  if (!isValidGitRefName(`${value}1`)) {
    throw new Error(`Invalid config field: ${label}`);
  }

  return value;
}

const VALID_REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "low", "medium", "high", "xhigh"]);
const VALID_LOCAL_REVIEW_POLICIES = new Set<LocalReviewPolicy>(["advisory", "block_ready", "block_merge"]);
const VALID_LOCAL_REVIEW_HIGH_SEVERITY_ACTIONS = new Set<LocalReviewHighSeverityAction>(["retry", "blocked"]);
const VALID_COPILOT_REVIEW_TIMEOUT_ACTIONS = new Set<CopilotReviewTimeoutAction>(["continue", "block"]);
const VALID_LOCAL_REVIEW_MINIMUM_SEVERITIES = new Set<LocalReviewReviewerThresholdConfig["minimumSeverity"]>(["low", "medium", "high"]);
const VALID_RUN_STATES = new Set<RunState>([
  "queued",
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "draft_pr",
  "local_review",
  "pr_open",
  "repairing_ci",
  "resolving_conflict",
  "waiting_ci",
  "addressing_review",
  "ready_to_merge",
  "merging",
  "done",
  "blocked",
  "failed",
]);

function parseReviewerThresholdConfig(
  value: unknown,
  defaults: LocalReviewReviewerThresholdConfig,
): LocalReviewReviewerThresholdConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const raw = value as Record<string, unknown>;
  return {
    confidenceThreshold:
      typeof raw.confidenceThreshold === "number" &&
      Number.isFinite(raw.confidenceThreshold) &&
      raw.confidenceThreshold >= 0 &&
      raw.confidenceThreshold <= 1
        ? raw.confidenceThreshold
        : defaults.confidenceThreshold,
    minimumSeverity:
      typeof raw.minimumSeverity === "string" &&
      VALID_LOCAL_REVIEW_MINIMUM_SEVERITIES.has(raw.minimumSeverity as LocalReviewReviewerThresholdConfig["minimumSeverity"])
        ? (raw.minimumSeverity as LocalReviewReviewerThresholdConfig["minimumSeverity"])
        : defaults.minimumSeverity,
  };
}

function parseReviewerThresholds(
  value: unknown,
  defaults: Record<LocalReviewReviewerType, LocalReviewReviewerThresholdConfig>,
): Record<LocalReviewReviewerType, LocalReviewReviewerThresholdConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const raw = value as Record<string, unknown>;
  return {
    generic: parseReviewerThresholdConfig(raw.generic, defaults.generic),
    specialist: parseReviewerThresholdConfig(raw.specialist, defaults.specialist),
  };
}

function parseReasoningPolicy(value: unknown): Partial<Record<RunState, ReasoningEffort>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, raw]) => VALID_RUN_STATES.has(key as RunState) && typeof raw === "string" && VALID_REASONING_EFFORTS.has(raw as ReasoningEffort))
    .map(([key, raw]) => [key as RunState, raw as ReasoningEffort]);

  return Object.fromEntries(entries) as Partial<Record<RunState, ReasoningEffort>>;
}

export function resolveConfigPath(configPath?: string): string {
  return configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function collectMissingRequiredFields(raw: Record<string, unknown>): string[] {
  const missing = REQUIRED_STRING_CONFIG_FIELDS.filter((field) => !hasNonEmptyString(raw[field])) as string[];
  if ((raw.codexModelStrategy === "fixed" || raw.codexModelStrategy === "alias") && !hasNonEmptyString(raw.codexModel)) {
    missing.push("codexModel");
  }
  if (
    (raw.boundedRepairModelStrategy === "fixed" || raw.boundedRepairModelStrategy === "alias") &&
    !hasNonEmptyString(raw.boundedRepairModel)
  ) {
    missing.push("boundedRepairModel");
  }
  if (
    (raw.localReviewModelStrategy === "fixed" || raw.localReviewModelStrategy === "alias") &&
    !hasNonEmptyString(raw.localReviewModel)
  ) {
    missing.push("localReviewModel");
  }

  return missing;
}

function extractInvalidFieldName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const match = error.message.match(/config field: ([A-Za-z0-9_]+)/);
  return match?.[1] ?? null;
}

export function loadConfigSummary(configPath?: string): ConfigLoadSummary {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      configPath: resolvedPath,
      status: "missing_config",
      missingRequiredFields: [],
      invalidFields: [],
      error: `Config file not found: ${resolvedPath}`,
      config: null,
    };
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseJson<Record<string, unknown>>(fs.readFileSync(resolvedPath, "utf8"), resolvedPath);
  } catch (error) {
    return {
      configPath: resolvedPath,
      status: "invalid_config",
      missingRequiredFields: [],
      invalidFields: [],
      error: error instanceof Error ? error.message : String(error),
      config: null,
    };
  }

  const missingRequiredFields = collectMissingRequiredFields(raw);

  try {
    return {
      configPath: resolvedPath,
      status: "ready",
      missingRequiredFields: [],
      invalidFields: [],
      error: null,
      config: loadConfig(resolvedPath),
    };
  } catch (error) {
    const invalidField = extractInvalidFieldName(error);
    return {
      configPath: resolvedPath,
      status: "invalid_config",
      missingRequiredFields,
      invalidFields: invalidField && !missingRequiredFields.includes(invalidField) ? [invalidField] : [],
      error: error instanceof Error ? error.message : String(error),
      config: null,
    };
  }
}

export function loadConfig(configPath?: string): SupervisorConfig {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = parseJson<Record<string, unknown>>(fs.readFileSync(resolvedPath, "utf8"), resolvedPath);
  const configDir = path.dirname(resolvedPath);
  const defaultLocalReviewConfidenceThreshold =
    typeof raw.localReviewConfidenceThreshold === "number" &&
    Number.isFinite(raw.localReviewConfidenceThreshold) &&
    raw.localReviewConfidenceThreshold >= 0 &&
    raw.localReviewConfidenceThreshold <= 1
      ? raw.localReviewConfidenceThreshold
      : 0.7;
  const config: SupervisorConfig = {
    repoPath: resolveMaybeRelative(configDir, assertString(raw.repoPath, "repoPath")),
    repoSlug: assertPattern(assertString(raw.repoSlug, "repoSlug"), "repoSlug", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    defaultBranch: assertGitRefName(assertString(raw.defaultBranch, "defaultBranch"), "defaultBranch"),
    workspaceRoot: resolveMaybeRelative(configDir, assertString(raw.workspaceRoot, "workspaceRoot")),
    stateBackend:
      raw.stateBackend === "sqlite" || raw.stateBackend === "json"
        ? raw.stateBackend
        : "json",
    stateFile: resolveMaybeRelative(configDir, assertString(raw.stateFile, "stateFile")),
    stateBootstrapFile:
      typeof raw.stateBootstrapFile === "string" && raw.stateBootstrapFile.trim() !== ""
        ? resolveMaybeRelative(configDir, raw.stateBootstrapFile)
        : undefined,
    codexBinary: resolveCommandLikeValue(configDir, assertString(raw.codexBinary, "codexBinary")),
    codexModelStrategy:
      raw.codexModelStrategy === "fixed" || raw.codexModelStrategy === "alias" || raw.codexModelStrategy === "inherit"
        ? raw.codexModelStrategy
        : "inherit",
    codexModel:
      typeof raw.codexModel === "string" && raw.codexModel.trim() !== ""
        ? raw.codexModel.trim()
        : undefined,
    boundedRepairModelStrategy:
      raw.boundedRepairModelStrategy === "fixed" ||
      raw.boundedRepairModelStrategy === "alias" ||
      raw.boundedRepairModelStrategy === "inherit"
        ? raw.boundedRepairModelStrategy
        : undefined,
    boundedRepairModel:
      typeof raw.boundedRepairModel === "string" && raw.boundedRepairModel.trim() !== ""
        ? raw.boundedRepairModel.trim()
        : undefined,
    localReviewModelStrategy:
      raw.localReviewModelStrategy === "fixed" || raw.localReviewModelStrategy === "alias" || raw.localReviewModelStrategy === "inherit"
        ? raw.localReviewModelStrategy
        : undefined,
    localReviewModel:
      typeof raw.localReviewModel === "string" && raw.localReviewModel.trim() !== ""
        ? raw.localReviewModel.trim()
        : undefined,
    codexReasoningEffortByState: parseReasoningPolicy(raw.codexReasoningEffortByState),
    codexReasoningEscalateOnRepeatedFailure:
      typeof raw.codexReasoningEscalateOnRepeatedFailure === "boolean"
        ? raw.codexReasoningEscalateOnRepeatedFailure
        : true,
    sharedMemoryFiles: Array.isArray(raw.sharedMemoryFiles)
      ? raw.sharedMemoryFiles.filter((value): value is string => typeof value === "string")
      : [],
    gsdEnabled:
      typeof raw.gsdEnabled === "boolean"
        ? raw.gsdEnabled
        : false,
    gsdAutoInstall:
      typeof raw.gsdAutoInstall === "boolean"
        ? raw.gsdAutoInstall
        : false,
    gsdInstallScope:
      raw.gsdInstallScope === "local" || raw.gsdInstallScope === "global"
        ? raw.gsdInstallScope
        : "global",
    gsdCodexConfigDir:
      typeof raw.gsdCodexConfigDir === "string" && raw.gsdCodexConfigDir.trim() !== ""
        ? resolveMaybeRelative(configDir, raw.gsdCodexConfigDir)
        : undefined,
    gsdPlanningFiles: Array.isArray(raw.gsdPlanningFiles)
      ? raw.gsdPlanningFiles.filter((value): value is string => typeof value === "string" && value.trim() !== "")
      : ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"],
    localReviewEnabled:
      typeof raw.localReviewEnabled === "boolean"
        ? raw.localReviewEnabled
        : false,
    localReviewAutoDetect:
      typeof raw.localReviewAutoDetect === "boolean"
        ? raw.localReviewAutoDetect
        : true,
    localReviewRoles: Array.isArray(raw.localReviewRoles)
      ? raw.localReviewRoles.filter((value): value is string => typeof value === "string" && value.trim() !== "")
      : [],
    localReviewArtifactDir:
      typeof raw.localReviewArtifactDir === "string" && raw.localReviewArtifactDir.trim() !== ""
        ? resolveMaybeRelative(configDir, raw.localReviewArtifactDir)
        : path.join(path.dirname(resolveMaybeRelative(configDir, assertString(raw.stateFile, "stateFile"))), "reviews"),
    localReviewConfidenceThreshold: defaultLocalReviewConfidenceThreshold,
    localReviewReviewerThresholds: parseReviewerThresholds(raw.localReviewReviewerThresholds, {
      generic: {
        confidenceThreshold: defaultLocalReviewConfidenceThreshold,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: defaultLocalReviewConfidenceThreshold,
        minimumSeverity: "low",
      },
    }),
    localReviewPolicy:
      typeof raw.localReviewPolicy === "string" && VALID_LOCAL_REVIEW_POLICIES.has(raw.localReviewPolicy as LocalReviewPolicy)
        ? (raw.localReviewPolicy as LocalReviewPolicy)
        : "block_ready",
    localReviewHighSeverityAction:
      typeof raw.localReviewHighSeverityAction === "string" &&
      VALID_LOCAL_REVIEW_HIGH_SEVERITY_ACTIONS.has(raw.localReviewHighSeverityAction as LocalReviewHighSeverityAction)
        ? (raw.localReviewHighSeverityAction as LocalReviewHighSeverityAction)
        : "blocked",
    reviewBotLogins: Array.isArray(raw.reviewBotLogins)
      ? raw.reviewBotLogins
          .filter((value): value is string => typeof value === "string" && value.trim() !== "")
          .map((value) => value.trim().toLowerCase())
      : ["copilot-pull-request-reviewer"],
    configuredReviewProviders: mapConfiguredReviewProviders(
      Array.isArray(raw.reviewBotLogins)
        ? raw.reviewBotLogins.filter((value): value is string => typeof value === "string")
        : ["copilot-pull-request-reviewer"],
    ),
    humanReviewBlocksMerge:
      typeof raw.humanReviewBlocksMerge === "boolean"
        ? raw.humanReviewBlocksMerge
        : true,
    issueJournalRelativePath:
      typeof raw.issueJournalRelativePath === "string" && raw.issueJournalRelativePath.trim() !== ""
        ? raw.issueJournalRelativePath
        : ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars:
      typeof raw.issueJournalMaxChars === "number" && raw.issueJournalMaxChars >= 2000
        ? raw.issueJournalMaxChars
        : 6000,
    issueLabel: typeof raw.issueLabel === "string" ? raw.issueLabel : undefined,
    issueSearch: typeof raw.issueSearch === "string" ? raw.issueSearch : undefined,
    skipTitlePrefixes: Array.isArray(raw.skipTitlePrefixes)
      ? raw.skipTitlePrefixes.filter((value): value is string => typeof value === "string")
      : ["Epic:"],
    branchPrefix: assertBranchPrefix(assertString(raw.branchPrefix, "branchPrefix"), "branchPrefix"),
    pollIntervalSeconds:
      typeof raw.pollIntervalSeconds === "number" && raw.pollIntervalSeconds > 0
        ? raw.pollIntervalSeconds
        : 120,
    copilotReviewWaitMinutes:
      typeof raw.copilotReviewWaitMinutes === "number" && raw.copilotReviewWaitMinutes >= 0
        ? raw.copilotReviewWaitMinutes
        : 10,
    copilotReviewTimeoutAction:
      typeof raw.copilotReviewTimeoutAction === "string" &&
      VALID_COPILOT_REVIEW_TIMEOUT_ACTIONS.has(raw.copilotReviewTimeoutAction as CopilotReviewTimeoutAction)
        ? (raw.copilotReviewTimeoutAction as CopilotReviewTimeoutAction)
        : "continue",
    configuredBotRateLimitWaitMinutes:
      typeof raw.configuredBotRateLimitWaitMinutes === "number" &&
      Number.isFinite(raw.configuredBotRateLimitWaitMinutes) &&
      raw.configuredBotRateLimitWaitMinutes >= 0
        ? raw.configuredBotRateLimitWaitMinutes
        : 0,
    configuredBotInitialGraceWaitSeconds:
      typeof raw.configuredBotInitialGraceWaitSeconds === "number" &&
      Number.isFinite(raw.configuredBotInitialGraceWaitSeconds) &&
      raw.configuredBotInitialGraceWaitSeconds >= 0
        ? raw.configuredBotInitialGraceWaitSeconds
        : 90,
    configuredBotSettledWaitSeconds:
      typeof raw.configuredBotSettledWaitSeconds === "number" &&
      Number.isFinite(raw.configuredBotSettledWaitSeconds) &&
      raw.configuredBotSettledWaitSeconds >= 0
        ? raw.configuredBotSettledWaitSeconds
        : 5,
    codexExecTimeoutMinutes:
      typeof raw.codexExecTimeoutMinutes === "number" && raw.codexExecTimeoutMinutes > 0
        ? raw.codexExecTimeoutMinutes
        : 30,
    maxCodexAttemptsPerIssue:
      typeof raw.maxCodexAttemptsPerIssue === "number" && raw.maxCodexAttemptsPerIssue > 0
        ? raw.maxCodexAttemptsPerIssue
        : 30,
    maxImplementationAttemptsPerIssue:
      typeof raw.maxImplementationAttemptsPerIssue === "number" && raw.maxImplementationAttemptsPerIssue > 0
        ? raw.maxImplementationAttemptsPerIssue
        : typeof raw.maxCodexAttemptsPerIssue === "number" && raw.maxCodexAttemptsPerIssue > 0
          ? raw.maxCodexAttemptsPerIssue
          : 30,
    maxRepairAttemptsPerIssue:
      typeof raw.maxRepairAttemptsPerIssue === "number" && raw.maxRepairAttemptsPerIssue > 0
        ? raw.maxRepairAttemptsPerIssue
        : typeof raw.maxCodexAttemptsPerIssue === "number" && raw.maxCodexAttemptsPerIssue > 0
          ? raw.maxCodexAttemptsPerIssue
          : 30,
    timeoutRetryLimit:
      typeof raw.timeoutRetryLimit === "number" && raw.timeoutRetryLimit >= 0
        ? raw.timeoutRetryLimit
        : 2,
    blockedVerificationRetryLimit:
      typeof raw.blockedVerificationRetryLimit === "number" && raw.blockedVerificationRetryLimit >= 0
        ? raw.blockedVerificationRetryLimit
        : 3,
    sameBlockerRepeatLimit:
      typeof raw.sameBlockerRepeatLimit === "number" && raw.sameBlockerRepeatLimit >= 0
        ? raw.sameBlockerRepeatLimit
        : 2,
    sameFailureSignatureRepeatLimit:
      typeof raw.sameFailureSignatureRepeatLimit === "number" && raw.sameFailureSignatureRepeatLimit >= 0
        ? raw.sameFailureSignatureRepeatLimit
        : 3,
    maxDoneWorkspaces:
      typeof raw.maxDoneWorkspaces === "number" && Number.isFinite(raw.maxDoneWorkspaces)
        ? raw.maxDoneWorkspaces
        : 24,
    cleanupDoneWorkspacesAfterHours:
      typeof raw.cleanupDoneWorkspacesAfterHours === "number" && Number.isFinite(raw.cleanupDoneWorkspacesAfterHours)
        ? raw.cleanupDoneWorkspacesAfterHours
        : 24,
    cleanupOrphanedWorkspacesAfterHours:
      typeof raw.cleanupOrphanedWorkspacesAfterHours === "number" && Number.isFinite(raw.cleanupOrphanedWorkspacesAfterHours)
        ? raw.cleanupOrphanedWorkspacesAfterHours
        : 24,
    mergeMethod:
      raw.mergeMethod === "merge" || raw.mergeMethod === "squash" || raw.mergeMethod === "rebase"
        ? raw.mergeMethod
        : "squash",
    draftPrAfterAttempt:
      typeof raw.draftPrAfterAttempt === "number" && raw.draftPrAfterAttempt >= 1
        ? raw.draftPrAfterAttempt
        : 1,
  };

  if ((config.codexModelStrategy === "fixed" || config.codexModelStrategy === "alias") && !config.codexModel) {
    throw new Error(`Missing or invalid config field: codexModel (required when codexModelStrategy=${config.codexModelStrategy})`);
  }
  if (
    config.boundedRepairModelStrategy &&
    (config.boundedRepairModelStrategy === "fixed" || config.boundedRepairModelStrategy === "alias") &&
    !config.boundedRepairModel
  ) {
    throw new Error(
      `Missing or invalid config field: boundedRepairModel (required when boundedRepairModelStrategy=${config.boundedRepairModelStrategy})`,
    );
  }
  if (
    config.localReviewModelStrategy &&
    (config.localReviewModelStrategy === "fixed" || config.localReviewModelStrategy === "alias") &&
    !config.localReviewModel
  ) {
    throw new Error(
      `Missing or invalid config field: localReviewModel (required when localReviewModelStrategy=${config.localReviewModelStrategy})`,
    );
  }

  return config;
}
