import fs from "node:fs";
import path from "node:path";
import {
  displayLocalCiCommand,
  findRepoOwnedWorkspacePreparationCandidate,
  loadConfigSummary,
  normalizeLocalCiCommand,
  resolveConfigPath,
  summarizeLocalCiContract,
  summarizeLocalReviewPosture,
  summarizeTrustDiagnostics,
  validateWorkspacePreparationCommandForWorktrees,
} from "./core/config";
import type { CodexModelStrategy, LocalCiContractSummary, LocalReviewPostureSummary, TrustDiagnosticsSummary } from "./core/types";
import { diagnoseSupervisorHost, type DoctorCheck, type DoctorCheckStatus } from "./doctor";
import { reviewProviderProfileFromConfig } from "./core/review-providers";
import type { ExecutionSafetyMode, TrustMode } from "./core/types";

export type SetupFieldState = "configured" | "missing" | "invalid";
export type SetupReadinessOverallStatus = "configured" | "missing" | "invalid";
export type SetupReadinessFieldKey =
  | "repoPath"
  | "repoSlug"
  | "defaultBranch"
  | "workspaceRoot"
  | "stateFile"
  | "codexBinary"
  | "branchPrefix"
  | "workspacePreparationCommand"
  | "localCiCommand"
  | "trustMode"
  | "executionSafetyMode"
  | "reviewProvider";
export type SetupReadinessConfigFieldKey =
  | SetupReadinessFieldKey
  | "codexModelStrategy"
  | "codexModel"
  | "boundedRepairModelStrategy"
  | "boundedRepairModel"
  | "localReviewModelStrategy"
  | "localReviewModel";

export type SetupReadinessFieldValueType =
  | "directory_path"
  | "repo_slug"
  | "git_ref"
  | "file_path"
  | "executable_path"
  | "text"
  | "trust_mode"
  | "execution_safety_mode"
  | "review_provider";

export interface SetupReadinessFieldMetadata {
  source: "config";
  editable: true;
  valueType: SetupReadinessFieldValueType;
}

export interface SetupReadinessField {
  key: SetupReadinessFieldKey;
  label: string;
  state: SetupFieldState;
  value: string | null;
  message: string;
  required: boolean;
  metadata: SetupReadinessFieldMetadata;
}

export type SetupReadinessRemediationKind =
  | "edit_config"
  | "configure_review_provider"
  | "authenticate_github"
  | "verify_codex_cli"
  | "repair_worktree_layout";

export interface SetupReadinessRemediation {
  kind: SetupReadinessRemediationKind;
  summary: string;
  fieldKeys: SetupReadinessConfigFieldKey[];
}

export interface SetupReadinessBlocker {
  code: string;
  message: string;
  fieldKeys: SetupReadinessConfigFieldKey[];
  remediation: SetupReadinessRemediation;
}

export type SetupReadinessModelRoutingStrategy = CodexModelStrategy | string;

export interface SetupReadinessHostSummary {
  overallStatus: DoctorCheckStatus | "not_ready";
  checks: DoctorCheck[];
}

export interface SetupReadinessProviderPosture {
  profile: "none" | "copilot" | "codex" | "coderabbit" | "custom";
  provider: string;
  reviewers: string[];
  signalSource: string;
  configured: boolean;
  summary: string;
}

export interface SetupReadinessTrustPosture extends TrustDiagnosticsSummary {
  configured?: boolean;
  summary: string;
}

export interface SetupReadinessModelRoutingTarget {
  key: "codex" | "bounded_repair" | "local_review";
  label: string;
  strategy: SetupReadinessModelRoutingStrategy;
  modelField: "codexModel" | "boundedRepairModel" | "localReviewModel";
  strategyField: "codexModelStrategy" | "boundedRepairModelStrategy" | "localReviewModelStrategy";
  model: string | null;
  overrideConfigured: boolean;
  invalidStrategy: boolean;
  requiresExplicitModel: boolean;
  missingExplicitModel: boolean;
  summary: string;
  guidance: string;
}

export interface SetupReadinessModelRoutingPosture {
  summary: string;
  invalid: boolean;
  targets: SetupReadinessModelRoutingTarget[];
}

export interface SetupReadinessReport {
  kind: "setup_readiness";
  ready: boolean;
  overallStatus: SetupReadinessOverallStatus;
  configPath: string;
  fields: SetupReadinessField[];
  blockers: SetupReadinessBlocker[];
  hostReadiness: SetupReadinessHostSummary;
  providerPosture: SetupReadinessProviderPosture;
  trustPosture: SetupReadinessTrustPosture;
  modelRoutingPosture?: SetupReadinessModelRoutingPosture;
  localCiContract?: LocalCiContractSummary;
  localReviewPosture?: LocalReviewPostureSummary;
}

interface DiagnoseSetupReadinessArgs {
  configPath?: string;
  authStatus?: () => Promise<{ ok: boolean; message: string | null }>;
}

type RawConfigDocument = Record<string, unknown> | null;

const SETUP_FIELD_DEFINITIONS: Array<{
  key: Exclude<SetupReadinessFieldKey, "reviewProvider">;
  label: string;
  required: boolean;
}> = [
  { key: "repoPath", label: "Repository path", required: true },
  { key: "repoSlug", label: "Repository slug", required: true },
  { key: "defaultBranch", label: "Default branch", required: true },
  { key: "workspaceRoot", label: "Workspace root", required: true },
  { key: "stateFile", label: "State file", required: true },
  { key: "codexBinary", label: "Codex binary", required: true },
  { key: "branchPrefix", label: "Branch prefix", required: true },
  { key: "workspacePreparationCommand", label: "Workspace preparation command", required: false },
  { key: "localCiCommand", label: "Local CI command", required: false },
  { key: "trustMode", label: "Trust mode", required: true },
  { key: "executionSafetyMode", label: "Execution safety mode", required: true },
];

const SETUP_FIELD_METADATA: Record<SetupReadinessFieldKey, SetupReadinessFieldMetadata> = {
  repoPath: { source: "config", editable: true, valueType: "directory_path" },
  repoSlug: { source: "config", editable: true, valueType: "repo_slug" },
  defaultBranch: { source: "config", editable: true, valueType: "git_ref" },
  workspaceRoot: { source: "config", editable: true, valueType: "directory_path" },
  stateFile: { source: "config", editable: true, valueType: "file_path" },
  codexBinary: { source: "config", editable: true, valueType: "executable_path" },
  branchPrefix: { source: "config", editable: true, valueType: "text" },
  workspacePreparationCommand: { source: "config", editable: true, valueType: "text" },
  localCiCommand: { source: "config", editable: true, valueType: "text" },
  trustMode: { source: "config", editable: true, valueType: "trust_mode" },
  executionSafetyMode: { source: "config", editable: true, valueType: "execution_safety_mode" },
  reviewProvider: { source: "config", editable: true, valueType: "review_provider" },
};

const VALID_TRUST_MODES = new Set<TrustMode>(["trusted_repo_and_authors", "untrusted_or_mixed"]);
const VALID_EXECUTION_SAFETY_MODES = new Set<ExecutionSafetyMode>(["unsandboxed_autonomous", "operator_gated"]);

function readRawConfigDocument(configPath: string): RawConfigDocument {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return displayLocalCiCommand(value as Parameters<typeof displayLocalCiCommand>[0]);
  }

  if (Array.isArray(value)) {
    const rendered = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").join(", ");
    return rendered.length > 0 ? rendered : null;
  }

  return null;
}

function readExactSetupStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function trustPostureFieldState(args: {
  key: "trustMode" | "executionSafetyMode";
  rawValue: unknown;
}): SetupFieldState {
  const { key, rawValue } = args;
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return "missing";
  }
  if (key === "trustMode") {
    return typeof rawValue === "string" && VALID_TRUST_MODES.has(rawValue as TrustMode) ? "configured" : "invalid";
  }
  return typeof rawValue === "string" && VALID_EXECUTION_SAFETY_MODES.has(rawValue as ExecutionSafetyMode)
    ? "configured"
    : "invalid";
}

function tryNormalizeLocalCiCommand(value: unknown): ReturnType<typeof normalizeLocalCiCommand> {
  try {
    return normalizeLocalCiCommand(value);
  } catch {
    return undefined;
  }
}

function buildFieldMessage(args: {
  field: SetupReadinessField;
  workspacePreparationWarning: string | null;
  recommendedWorkspacePreparationCommand: string | null;
}): string {
  const { field, workspacePreparationWarning, recommendedWorkspacePreparationCommand } = args;
  if (field.key === "workspacePreparationCommand") {
    if (workspacePreparationWarning !== null && field.state === "invalid") {
      return recommendedWorkspacePreparationCommand === null
        ? workspacePreparationWarning
        : `${workspacePreparationWarning} Recommended repo-native command: ${recommendedWorkspacePreparationCommand}.`;
    }

    if (field.state === "configured") {
      return "Workspace preparation command is configured.";
    }

    return recommendedWorkspacePreparationCommand === null
      ? "Workspace preparation command is optional until you opt in to the repo-owned contract."
      : `Workspace preparation command is optional until you opt in to the repo-owned contract. Recommended repo-native command: ${recommendedWorkspacePreparationCommand}.`;
  }

  if (field.key === "localCiCommand") {
    if (field.state === "configured") {
      return "Local CI command is configured.";
    }

    return "Local CI command is optional until you opt in to the repo-owned contract.";
  }

  if (field.key === "trustMode") {
    if (field.state === "configured") {
      return "Trust mode is explicitly configured.";
    }
    if (field.state === "missing") {
      return "Trust mode needs an explicit first-run setup decision.";
    }
    return "Trust mode must be trusted_repo_and_authors or untrusted_or_mixed.";
  }

  if (field.key === "executionSafetyMode") {
    if (field.state === "configured") {
      return "Execution safety mode is explicitly configured.";
    }
    if (field.state === "missing") {
      return "Execution safety mode needs an explicit first-run setup decision.";
    }
    return "Execution safety mode must be unsandboxed_autonomous or operator_gated.";
  }

  if (field.state === "configured") {
    return `${field.label} is configured.`;
  }

  if (!field.required) {
    return `${field.label} is optional.`;
  }

  if (field.state === "missing") {
    return `${field.label} is required before first-run setup is complete.`;
  }

  return `${field.label} is present but invalid.`;
}

function buildConfigFields(args: {
  rawConfig: RawConfigDocument;
  configSummary: ReturnType<typeof loadConfigSummary>;
  workspacePreparationWarning: string | null;
  recommendedWorkspacePreparationCommand: string | null;
}): SetupReadinessField[] {
  const { rawConfig, configSummary, workspacePreparationWarning, recommendedWorkspacePreparationCommand } = args;
  const resolvedConfig = configSummary.config;
  const fields = SETUP_FIELD_DEFINITIONS.map(({ key, label, required }) => {
    const rawValue = rawConfig?.[key];
    const explicitValue =
      key === "trustMode" || key === "executionSafetyMode"
        ? readExactSetupStringValue(rawValue)
        : displayValue(rawValue);
    const resolvedValue = key === "trustMode" || key === "executionSafetyMode"
      ? explicitValue
      : resolvedConfig !== null ? displayValue(resolvedConfig[key]) : explicitValue;
    const state: SetupFieldState = key === "trustMode" || key === "executionSafetyMode"
      ? trustPostureFieldState({ key, rawValue })
        : key === "workspacePreparationCommand" && workspacePreparationWarning !== null
      ? "invalid"
      : configSummary.missingRequiredFields.includes(key)
      ? "missing"
      : configSummary.invalidFields.includes(key)
        ? "invalid"
        : resolvedValue === null
          ? "missing"
          : "configured";
    const field: SetupReadinessField = {
      key,
      label,
      state,
      value: resolvedValue,
      message: "",
      required,
      metadata: SETUP_FIELD_METADATA[key],
    };
    return {
      ...field,
      message: buildFieldMessage({ field, workspacePreparationWarning, recommendedWorkspacePreparationCommand }),
    };
  });

  const reviewBotLogins = rawConfig?.reviewBotLogins;
  const normalizedReviewers =
    resolvedConfig?.configuredReviewProviders?.flatMap((provider) => provider.reviewerLogins) ??
    (Array.isArray(reviewBotLogins)
      ? reviewBotLogins.filter((value): value is string => typeof value === "string" && value.trim() !== "")
      : []);
  const reviewProviderField: SetupReadinessField = {
    key: "reviewProvider",
    label: "Review provider",
    state: normalizedReviewers.length > 0 ? "configured" : "missing",
    value: normalizedReviewers.length > 0 ? normalizedReviewers.join(", ") : null,
    message: "",
    required: true,
    metadata: SETUP_FIELD_METADATA.reviewProvider,
  };

  return [
    ...fields,
    {
      ...reviewProviderField,
      message:
        reviewProviderField.state === "configured"
          ? "Review provider posture is configured."
          : "Configure at least one review provider before first-run setup is complete.",
    },
  ];
}

function buildProviderPosture(
  config: ReturnType<typeof loadConfigSummary>["config"],
): SetupReadinessProviderPosture {
  if (!config) {
    return {
      profile: "none",
      provider: "none",
      reviewers: [],
      signalSource: "none",
      configured: false,
      summary: "No review provider is configured.",
    };
  }

  const profile = reviewProviderProfileFromConfig(config);
  if (profile.profile === "none") {
    return {
      ...profile,
      configured: false,
      summary: "No review provider is configured.",
    };
  }

  return {
    ...profile,
    configured: true,
    summary: `Review provider posture uses ${profile.provider} via ${profile.signalSource}.`,
  };
}

function buildTrustPostureFromRaw(
  rawConfig: RawConfigDocument,
  config: ReturnType<typeof loadConfigSummary>["config"],
): SetupReadinessTrustPosture {
  const rawTrustMode = rawConfig?.trustMode;
  const rawExecutionSafetyMode = rawConfig?.executionSafetyMode;
  const configured =
    typeof rawTrustMode === "string" &&
    VALID_TRUST_MODES.has(rawTrustMode as TrustMode) &&
    typeof rawExecutionSafetyMode === "string" &&
    VALID_EXECUTION_SAFETY_MODES.has(rawExecutionSafetyMode as ExecutionSafetyMode);
  const trust = summarizeTrustDiagnostics(
    config ?? {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    },
  );

  return {
    ...trust,
    configured,
    summary:
      !configured
        ? "Trust posture needs an explicit first-run setup decision."
        : trust.warning === null
        ? "Trust posture avoids the default unsandboxed trusted-input assumption."
        : "Trusted inputs with unsandboxed autonomous execution. This is appropriate only for a trusted solo-lane repository and trusted GitHub authors.",
  };
}

function normalizeModelStrategy(value: unknown): CodexModelStrategy | undefined {
  return value === "inherit" || value === "fixed" || value === "alias" ? value : undefined;
}

function normalizeModelValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readRawConfiguredStrategy(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function buildModelRoutingTarget(args: {
  key: "codex" | "bounded_repair" | "local_review";
  label: string;
  strategyField: "codexModelStrategy" | "boundedRepairModelStrategy" | "localReviewModelStrategy";
  modelField: "codexModel" | "boundedRepairModel" | "localReviewModel";
  rawConfig: Record<string, unknown>;
  config: ReturnType<typeof loadConfigSummary>["config"];
}): SetupReadinessModelRoutingTarget {
  const { key, label, strategyField, modelField, rawConfig, config } = args;
  const parsedStrategy = config?.[strategyField];
  const rawConfiguredStrategy = readRawConfiguredStrategy(rawConfig[strategyField]);
  const rawStrategy = normalizeModelStrategy(rawConfiguredStrategy);
  const invalidStrategy = rawConfiguredStrategy !== null && rawStrategy === undefined;
  const strategy = invalidStrategy ? rawConfiguredStrategy : (parsedStrategy ?? rawStrategy ?? "inherit");
  const overrideConfigured = parsedStrategy !== undefined || rawConfiguredStrategy !== null;
  const model = normalizeModelValue(config?.[modelField] ?? rawConfig[modelField]);
  const requiresExplicitModel = !invalidStrategy && (strategy === "fixed" || strategy === "alias");
  const missingExplicitModel = requiresExplicitModel && model === null;

  const routeSubject =
    key === "codex"
      ? "Default Codex turns"
      : key === "bounded_repair"
        ? "Bounded repair turns"
        : "Generic local-review turns";
  const fallbackRoute =
    key === "codex"
      ? "the host Codex default model"
      : "the default Codex route";

  let summary: string;
  if (invalidStrategy) {
    summary = `${routeSubject} use unsupported ${strategy} routing from ${strategyField}.`;
  } else if (strategy === "inherit") {
    summary =
      key === "codex"
        ? `${routeSubject} inherit ${fallbackRoute}.`
        : overrideConfigured
          ? `${routeSubject} explicitly inherit ${fallbackRoute}.`
          : `${routeSubject} currently inherit ${fallbackRoute}.`;
  } else if (model !== null) {
    summary =
      strategy === "fixed"
        ? `${routeSubject} are pinned to ${model}.`
        : `${routeSubject} resolve through alias ${model}.`;
  } else {
    summary = `${routeSubject} are set to ${strategy} routing, but ${modelField} is missing.`;
  }

  const guidance =
    invalidStrategy
      ? `Fail-closed: ${strategyField}=${strategy} is unsupported. Use inherit, fixed, or alias.`
      : strategy === "inherit"
      ? key === "codex"
        ? 'Recommended default: keep `codexModelStrategy: "inherit"` and set the Codex host default model instead of pinning it here.'
        : `Leave ${strategyField} unset or use \`"inherit"\` to keep following the default Codex route.`
      : missingExplicitModel
        ? `Fail-closed: ${strategyField}=${strategy} requires an explicit ${modelField} value before execution can proceed.`
        : `${strategyField}=${strategy} is valid only because ${modelField} is set explicitly.`;

  return {
    key,
    label,
    strategy,
    modelField,
    strategyField,
    model,
    overrideConfigured,
    invalidStrategy,
    requiresExplicitModel,
    missingExplicitModel,
    summary,
    guidance,
  };
}

function buildModelRoutingPosture(args: {
  rawConfig: RawConfigDocument;
  config: ReturnType<typeof loadConfigSummary>["config"];
}): SetupReadinessModelRoutingPosture {
  const rawConfig = args.rawConfig ?? {};
  const targets: SetupReadinessModelRoutingTarget[] = [
    buildModelRoutingTarget({
      key: "codex",
      label: "Default Codex route",
      strategyField: "codexModelStrategy",
      modelField: "codexModel",
      rawConfig,
      config: args.config,
    }),
    buildModelRoutingTarget({
      key: "bounded_repair",
      label: "Bounded repair override",
      strategyField: "boundedRepairModelStrategy",
      modelField: "boundedRepairModel",
      rawConfig,
      config: args.config,
    }),
    buildModelRoutingTarget({
      key: "local_review",
      label: "Generic local-review override",
      strategyField: "localReviewModelStrategy",
      modelField: "localReviewModel",
      rawConfig,
      config: args.config,
    }),
  ];
  const invalid = targets.some((target) => target.invalidStrategy || target.missingExplicitModel);
  const inheritedCount = targets.filter((target) => target.strategy === "inherit").length;
  const summary = invalid
    ? "Model routing is invalid until every strategy is supported and every fixed or alias strategy has an explicit model value."
    : inheritedCount === targets.length
      ? "Model routing follows the host Codex default model unless you opt into a per-target override."
      : inheritedCount === 0
        ? "Model routing uses explicit per-target overrides for every route."
      : "Model routing mixes inherited defaults with explicit per-target overrides.";

  return {
    summary,
    invalid,
    targets,
  };
}

function buildHostReadiness(
  checks: DoctorCheck[] | null,
  overallStatus: DoctorCheckStatus | null,
): SetupReadinessHostSummary {
  if (!checks || !overallStatus) {
    return {
      overallStatus: "not_ready",
      checks: [],
    };
  }

  return {
    overallStatus,
    checks: checks.map((check) => ({
      ...check,
      details: [...check.details],
    })),
  };
}

function buildBlockers(args: {
  fields: SetupReadinessField[];
  hostReadiness: SetupReadinessHostSummary;
  modelRoutingPosture: SetupReadinessModelRoutingPosture;
}): SetupReadinessBlocker[] {
  const blockers: SetupReadinessBlocker[] = [];

  for (const field of args.fields) {
    if (field.state === "configured" || (!field.required && field.state === "missing")) {
      continue;
    }

    blockers.push({
      code: `${field.state}_${field.key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)}`,
      message:
        field.key === "reviewProvider" && field.state === "missing"
          ? "Configure at least one review provider before first-run setup is complete."
          : field.message,
      fieldKeys: [field.key],
      remediation:
        field.key === "reviewProvider" && field.state === "missing"
          ? {
            kind: "configure_review_provider",
            summary: "Configure at least one review provider before first-run setup is complete.",
            fieldKeys: [field.key],
          }
          : {
            kind: "edit_config",
            summary: field.message,
            fieldKeys: [field.key],
          },
    });
  }

  const hostBlockerChecks = new Set<DoctorCheck["name"]>(["github_auth", "codex_cli", "worktrees"]);
  for (const check of args.hostReadiness.checks) {
    if (check.status !== "fail" || !hostBlockerChecks.has(check.name)) {
      continue;
    }

    blockers.push({
      code: `host_${check.name}`,
      message: check.summary,
      fieldKeys: check.name === "worktrees" ? ["repoPath", "workspaceRoot"] : [],
      remediation:
        check.name === "github_auth"
          ? {
            kind: "authenticate_github",
            summary: check.summary,
            fieldKeys: [],
          }
          : check.name === "codex_cli"
            ? {
              kind: "verify_codex_cli",
              summary: check.summary,
              fieldKeys: ["codexBinary"],
            }
            : {
              kind: "repair_worktree_layout",
              summary: check.summary,
              fieldKeys: ["repoPath", "workspaceRoot"],
            },
    });
  }

  for (const target of args.modelRoutingPosture.targets) {
    if (target.invalidStrategy) {
      blockers.push({
        code: `invalid_${target.strategyField.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)}`,
        message: target.guidance,
        fieldKeys: [target.strategyField],
        remediation: {
          kind: "edit_config",
          summary: target.guidance,
          fieldKeys: [target.strategyField],
        },
      });
      continue;
    }

    if (!target.missingExplicitModel) {
      continue;
    }

    blockers.push({
      code: `missing_${target.modelField.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)}`,
      message: target.guidance,
      fieldKeys: [target.modelField],
      remediation: {
        kind: "edit_config",
        summary: target.guidance,
        fieldKeys: [target.modelField],
      },
    });
  }

  return blockers;
}

function overallStatusFromFields(
  fields: SetupReadinessField[],
  modelRoutingPosture: SetupReadinessModelRoutingPosture,
): SetupReadinessOverallStatus {
  if (modelRoutingPosture.invalid) {
    return "invalid";
  }

  if (fields.some((field) => field.state === "invalid")) {
    return "invalid";
  }

  if (fields.some((field) => field.required && field.state === "missing")) {
    return "missing";
  }

  return "configured";
}

export async function diagnoseSetupReadiness(
  args: DiagnoseSetupReadinessArgs = {},
): Promise<SetupReadinessReport> {
  const configSummary = loadConfigSummary(args.configPath);
  const configPath = resolveConfigPath(args.configPath);
  const rawConfig = readRawConfigDocument(configPath);
  const rawConfigDocument = rawConfig ?? {};
  const fallbackRepoPath =
    typeof rawConfigDocument.repoPath === "string" && rawConfigDocument.repoPath.trim() !== ""
      ? path.resolve(path.dirname(configPath), rawConfigDocument.repoPath)
      : undefined;
  const localCiContractConfig = configSummary.config ?? {
    localCiCommand: tryNormalizeLocalCiCommand(rawConfigDocument.localCiCommand),
    workspacePreparationCommand: tryNormalizeLocalCiCommand(rawConfigDocument.workspacePreparationCommand),
    localCiCandidateDismissed: rawConfigDocument.localCiCandidateDismissed === true,
    repoPath: fallbackRepoPath,
  };
  const workspacePreparationWarning = validateWorkspacePreparationCommandForWorktrees(localCiContractConfig);
  const recommendedWorkspacePreparationCommand = findRepoOwnedWorkspacePreparationCandidate(localCiContractConfig.repoPath);
  const fields = buildConfigFields({
    rawConfig,
    configSummary,
    workspacePreparationWarning,
    recommendedWorkspacePreparationCommand,
  });
  const modelRoutingPosture = buildModelRoutingPosture({
    rawConfig,
    config: configSummary.config,
  });
  const hostDiagnostics = configSummary.config
    ? await diagnoseSupervisorHost({
      config: configSummary.config,
      authStatus: args.authStatus,
    })
    : null;
  const hostReadiness = buildHostReadiness(hostDiagnostics?.checks ?? null, hostDiagnostics?.overallStatus ?? null);
  const blockers = buildBlockers({ fields, hostReadiness, modelRoutingPosture });

  return {
    kind: "setup_readiness",
    ready: blockers.length === 0,
    overallStatus: overallStatusFromFields(fields, modelRoutingPosture),
    configPath,
    fields,
    blockers,
    hostReadiness,
    providerPosture: buildProviderPosture(configSummary.config),
    trustPosture: buildTrustPostureFromRaw(rawConfig, configSummary.config),
    modelRoutingPosture,
    localCiContract: summarizeLocalCiContract(localCiContractConfig),
    localReviewPosture: configSummary.config ? summarizeLocalReviewPosture(configSummary.config) : undefined,
  };
}
