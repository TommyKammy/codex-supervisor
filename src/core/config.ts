import fs from "node:fs";
import path from "node:path";
import {
  CadenceDiagnosticsSummary,
  CopilotReviewTimeoutAction,
  ExecutionSafetyMode,
  LocalCiCommandConfig,
  LocalCiContractSummary,
  LocalReviewHighSeverityAction,
  LocalReviewPolicy,
  LocalReviewReviewerThresholdConfig,
  LocalReviewReviewerType,
  ShellLocalCiCommandConfig,
  ReasoningEffort,
  RunState,
  StructuredLocalCiCommandConfig,
  SupervisorConfig,
  TrustDiagnosticsSummary,
  TrustMode,
  WorkspacePreparationContractSummary,
} from "./types";
import { DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH } from "./journal";
import { mapConfiguredReviewProviders } from "./review-providers";
import { isValidGitRefName, parseJson, resolveMaybeRelative } from "./utils";

const DEFAULT_CONFIG_FILE = "supervisor.config.json";
export const DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW = 100;
export const LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH = ".codex-supervisor/issue-journal.md";
export const PREFERRED_ISSUE_JOURNAL_RELATIVE_PATH = ".codex-supervisor/issues/{issueNumber}/issue-journal.md";
export const MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING =
  "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.";
const LOCAL_CI_SCRIPT_CANDIDATES = ["verify:supervisor-pre-pr", "verify:pre-pr", "ci:local"] as const;
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
  trustDiagnostics: TrustDiagnosticsSummary | null;
}

function buildConfigLoadSummaryFromDocument(raw: Record<string, unknown>, resolvedPath: string): ConfigLoadSummary {
  const missingRequiredFields = collectMissingRequiredFields(raw);

  try {
    const config = parseSupervisorConfigDocument(raw, resolvedPath);
    return {
      configPath: resolvedPath,
      status: "ready",
      missingRequiredFields: [],
      invalidFields: [],
      error: null,
      config,
      trustDiagnostics: summarizeTrustDiagnostics(config),
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
      trustDiagnostics: null,
    };
  }
}

function resolveCommandLikeValue(baseDir: string, value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return /[\\/]/.test(value) ? resolveMaybeRelative(baseDir, value) : value;
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${fieldName}[${index}] must be a string.`);
    }

    return entry;
  });
}

export function normalizeLocalCiCommand(value: unknown): LocalCiCommandConfig | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" ? trimmed : undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (raw.mode === "structured") {
    if (typeof raw.executable !== "string" || raw.executable.trim() === "") {
      throw new Error("localCiCommand.executable must be a non-empty string.");
    }

    const structuredCommand: StructuredLocalCiCommandConfig = {
      mode: "structured",
      executable: raw.executable.trim(),
    };

    if ("args" in raw) {
      structuredCommand.args = normalizeStringArray(raw.args, "localCiCommand.args");
    }

    return structuredCommand;
  }

  if (raw.mode === "shell") {
    if (typeof raw.command !== "string" || raw.command.trim() === "") {
      throw new Error("localCiCommand.command must be a non-empty string.");
    }

    const shellCommand: ShellLocalCiCommandConfig = {
      mode: "shell",
      command: raw.command.trim(),
    };
    return shellCommand;
  }

  throw new Error("localCiCommand must be a non-empty string or an object with mode structured|shell.");
}

export function displayLocalCiCommand(command: LocalCiCommandConfig | undefined): string | null {
  if (typeof command === "string") {
    const trimmed = command.trim();
    return trimmed !== "" ? trimmed : null;
  }

  if (!command) {
    return null;
  }

  if (command.mode === "structured") {
    return [command.executable, ...(command.args ?? [])].join(" ").trim() || null;
  }

  return command.command.trim() || null;
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

function parseNonNegativeNumberWithDefault(value: unknown, field: string, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid config field: ${field}`);
  }

  return value;
}

const VALID_REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "low", "medium", "high", "xhigh"]);
const VALID_TRUST_MODES = new Set<TrustMode>(["trusted_repo_and_authors", "untrusted_or_mixed"]);
const VALID_EXECUTION_SAFETY_MODES = new Set<ExecutionSafetyMode>(["unsandboxed_autonomous", "operator_gated"]);
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
  config: Pick<SupervisorConfig, "workspacePreparationCommand" | "localCiCommand">,
): WorkspacePreparationContractSummary {
  const command = displayLocalCiCommand(config.workspacePreparationCommand);
  const warning = buildMissingWorkspacePreparationContractWarning(config);
  if (command !== null) {
    return {
      configured: true,
      command,
      source: "config",
      summary: "Repo-owned workspace preparation contract is configured.",
      warning: null,
    };
  }

  return {
    configured: false,
    command: null,
    source: "config",
    summary: "No repo-owned workspace preparation contract is configured.",
    warning,
  };
}

export function buildMissingWorkspacePreparationContractWarning(
  config: Pick<SupervisorConfig, "localCiCommand" | "workspacePreparationCommand">,
): string | null {
  if (displayLocalCiCommand(config.localCiCommand) === null || displayLocalCiCommand(config.workspacePreparationCommand) !== null) {
    return null;
  }

  return MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING;
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
      trustDiagnostics: null,
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
      trustDiagnostics: null,
    };
  }

  return buildConfigLoadSummaryFromDocument(raw, resolvedPath);
}

export function loadConfigSummaryFromDocument(raw: Record<string, unknown>, configPath: string): ConfigLoadSummary {
  return buildConfigLoadSummaryFromDocument(raw, resolveConfigPath(configPath));
}

export function loadConfig(configPath?: string): SupervisorConfig {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = parseJson<Record<string, unknown>>(fs.readFileSync(resolvedPath, "utf8"), resolvedPath);
  return parseSupervisorConfigDocument(raw, resolvedPath);
}

function parseSupervisorConfigDocument(raw: Record<string, unknown>, resolvedPath: string): SupervisorConfig {
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
    trustMode:
      typeof raw.trustMode === "string" && VALID_TRUST_MODES.has(raw.trustMode as TrustMode)
        ? (raw.trustMode as TrustMode)
        : "trusted_repo_and_authors",
    executionSafetyMode:
      typeof raw.executionSafetyMode === "string" &&
      VALID_EXECUTION_SAFETY_MODES.has(raw.executionSafetyMode as ExecutionSafetyMode)
        ? (raw.executionSafetyMode as ExecutionSafetyMode)
        : "unsandboxed_autonomous",
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
        : DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH,
    issueJournalMaxChars:
      typeof raw.issueJournalMaxChars === "number" && raw.issueJournalMaxChars >= 2000
        ? raw.issueJournalMaxChars
        : 6000,
    issueLabel: typeof raw.issueLabel === "string" ? raw.issueLabel : undefined,
    issueSearch: typeof raw.issueSearch === "string" ? raw.issueSearch : undefined,
    workspacePreparationCommand: normalizeLocalCiCommand(raw.workspacePreparationCommand),
    localCiCommand: normalizeLocalCiCommand(raw.localCiCommand),
    candidateDiscoveryFetchWindow:
      typeof raw.candidateDiscoveryFetchWindow === "number" &&
      Number.isFinite(raw.candidateDiscoveryFetchWindow) &&
      Number.isInteger(raw.candidateDiscoveryFetchWindow) &&
      raw.candidateDiscoveryFetchWindow > 0
        ? raw.candidateDiscoveryFetchWindow
        : DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW,
    skipTitlePrefixes: Array.isArray(raw.skipTitlePrefixes)
      ? raw.skipTitlePrefixes.filter((value): value is string => typeof value === "string")
      : ["Epic:"],
    branchPrefix: assertBranchPrefix(assertString(raw.branchPrefix, "branchPrefix"), "branchPrefix"),
    pollIntervalSeconds:
      typeof raw.pollIntervalSeconds === "number" && raw.pollIntervalSeconds > 0
        ? raw.pollIntervalSeconds
        : 120,
    mergeCriticalRecheckSeconds:
      typeof raw.mergeCriticalRecheckSeconds === "number" &&
      Number.isFinite(raw.mergeCriticalRecheckSeconds) &&
      Number.isInteger(raw.mergeCriticalRecheckSeconds) &&
      raw.mergeCriticalRecheckSeconds > 0
        ? raw.mergeCriticalRecheckSeconds
        : undefined,
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
    cleanupOrphanedWorkspacesAfterHours: parseNonNegativeNumberWithDefault(
      raw.cleanupOrphanedWorkspacesAfterHours,
      "cleanupOrphanedWorkspacesAfterHours",
      24,
    ),
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
