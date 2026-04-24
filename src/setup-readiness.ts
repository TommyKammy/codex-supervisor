import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_FIELD_POSTURE_METADATA,
  CONFIG_FIELD_POSTURE_TIERS,
  type ConfigFieldName,
  type ConfigFieldPostureMetadata,
  type ConfigFieldPostureTier,
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
import type { OperatorActionToken } from "./operator-actions";

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
  | ConfigFieldName
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

export interface SetupReadinessConfigPostureField {
  key: ConfigFieldName;
  label: string;
  state: SetupFieldState;
  value: string | null;
  message: string;
  required: boolean;
  metadata: SetupReadinessFieldMetadata;
  posture: ConfigFieldPostureMetadata;
}

export interface SetupReadinessConfigPostureGroup {
  tier: ConfigFieldPostureTier;
  label: string;
  summary: string;
  fields: SetupReadinessConfigPostureField[];
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

export interface SetupReadinessNextAction {
  action: OperatorActionToken;
  source: string;
  priority: number;
  required: boolean;
  summary: string;
  fieldKeys: SetupReadinessConfigFieldKey[];
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
  configPostureGroups?: SetupReadinessConfigPostureGroup[];
  blockers: SetupReadinessBlocker[];
  nextActions: SetupReadinessNextAction[];
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
const SETUP_POSTURE_GROUP_LABELS: Record<ConfigFieldPostureTier, string> = {
  required: "Required setup decisions",
  recommended: "Recommended setup contracts",
  advanced: "Advanced settings",
  dangerous_explicit_opt_in: "Dangerous explicit opt-in settings",
};
const SETUP_POSTURE_GROUP_SUMMARIES: Record<ConfigFieldPostureTier, string> = {
  required: "Missing or invalid required setup decisions are first-run blockers.",
  recommended: "Recommended fields improve repeatability without blocking first-run setup.",
  advanced: "Advanced settings stay separate from first-run work until explicitly reviewed.",
  dangerous_explicit_opt_in:
    "Dangerous explicit opt-in settings are never presented as routine defaults or required next steps.",
};
const POSTURE_FIELD_ALIASES: Partial<Record<ConfigFieldName, SetupReadinessFieldKey>> = {
  reviewBotLogins: "reviewProvider",
};

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

function displayConfigFieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function displayPostureConfigValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const rendered = value
      .map((entry) => displayPostureConfigValue(entry))
      .filter((entry): entry is string => entry !== null)
      .join(", ");
    return rendered.length > 0 ? rendered : null;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
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

function buildMissingPostureMessage(posture: ConfigFieldPostureMetadata): string {
  if (posture.tier === "required") {
    return posture.requirementScope === "first_run_setup"
      ? `${displayConfigFieldLabel(posture.field)} needs an explicit first-run setup decision.`
      : `${displayConfigFieldLabel(posture.field)} is required before first-run setup is complete.`;
  }
  if (posture.tier === "recommended") {
    return `${displayConfigFieldLabel(posture.field)} is recommended, but setup can continue until you opt in.`;
  }
  if (posture.tier === "advanced") {
    return "Advanced setting is unset; inherited defaults remain in effect.";
  }
  return "Dangerous explicit opt-in setting is unset; conservative behavior remains in effect.";
}

function metadataForPostureField(field: ConfigFieldName): SetupReadinessFieldMetadata {
  const existing = SETUP_FIELD_METADATA[field as SetupReadinessFieldKey];
  return existing ?? { source: "config", editable: true, valueType: "text" };
}

function buildConfigPostureGroups(args: {
  rawConfig: RawConfigDocument;
  configSummary: ReturnType<typeof loadConfigSummary>;
  fields: SetupReadinessField[];
  modelRoutingPosture: SetupReadinessModelRoutingPosture;
}): SetupReadinessConfigPostureGroup[] {
  const fieldByKey = new Map(args.fields.map((field) => [field.key, field]));
  const resolvedConfig = args.configSummary.config;
  const rawConfig = args.rawConfig ?? {};
  const postureFields = Object.values(CONFIG_FIELD_POSTURE_METADATA)
    .filter((entry): entry is ConfigFieldPostureMetadata => Boolean(entry))
    .map((posture): SetupReadinessConfigPostureField => {
      const existingKey = POSTURE_FIELD_ALIASES[posture.field] ?? (posture.field as SetupReadinessFieldKey);
      const existing = fieldByKey.get(existingKey);
      if (existing) {
        return {
          ...existing,
          key: posture.field,
          posture,
        };
      }

      const hasRawValue = Object.prototype.hasOwnProperty.call(rawConfig, posture.field);
      const value = displayPostureConfigValue(
        hasRawValue
          ? rawConfig[posture.field]
          : posture.tier === "required"
            ? resolvedConfig?.[posture.field]
            : undefined,
      );
      const invalidModelRoutingTarget = args.modelRoutingPosture.targets.find(
        (target) => target.strategyField === posture.field && target.invalidStrategy,
      );
      const state: SetupFieldState = invalidModelRoutingTarget || args.configSummary.invalidFields.includes(posture.field)
        ? "invalid"
        : value === null
          ? "missing"
          : "configured";
      return {
        key: posture.field,
        label: displayConfigFieldLabel(posture.field),
        state,
        value,
        message: invalidModelRoutingTarget
          ? invalidModelRoutingTarget.guidance
          : state === "invalid"
            ? `${displayConfigFieldLabel(posture.field)} is present but invalid.`
            : value === null
              ? buildMissingPostureMessage(posture)
              : `${displayConfigFieldLabel(posture.field)} is configured.`,
        required: posture.tier === "required",
        metadata: metadataForPostureField(posture.field),
        posture,
      };
    });

  return CONFIG_FIELD_POSTURE_TIERS.map((tier) => ({
    tier,
    label: SETUP_POSTURE_GROUP_LABELS[tier],
    summary: SETUP_POSTURE_GROUP_SUMMARIES[tier],
    fields: postureFields.filter((field) => field.posture.tier === tier),
  }));
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

function sortNextActions(actions: SetupReadinessNextAction[]): SetupReadinessNextAction[] {
  return [...actions].sort((left, right) => right.priority - left.priority);
}

function buildNextActions(args: {
  blockers: SetupReadinessBlocker[];
  configPostureGroups: SetupReadinessConfigPostureGroup[];
  localCiContract: LocalCiContractSummary;
  recommendedWorkspacePreparationCommand: string | null;
  workspacePreparationCommand: ReturnType<typeof normalizeLocalCiCommand>;
}): SetupReadinessNextAction[] {
  const actions: SetupReadinessNextAction[] = [];
  const workspacePreparationField = args.configPostureGroups
    .flatMap((group) => group.fields)
    .find((field) => field.key === "workspacePreparationCommand");
  const workspacePreparationCommandConfigured = args.workspacePreparationCommand !== undefined;

  for (const blocker of args.blockers) {
    actions.push({
      action: "fix_config",
      source: blocker.code,
      priority: 100,
      required: true,
      summary: blocker.remediation.summary,
      fieldKeys: [...blocker.remediation.fieldKeys],
    });
  }

  if (
    args.recommendedWorkspacePreparationCommand !== null &&
    !workspacePreparationCommandConfigured &&
    workspacePreparationField?.state !== "configured"
  ) {
    actions.push({
      action: "adopt_local_ci",
      source: "workspace_preparation_candidate",
      priority: 55,
      required: false,
      summary:
        `Optional: adopt the repo-owned workspace preparation command ${args.recommendedWorkspacePreparationCommand} in workspacePreparationCommand, or leave it unset until you want the setup contract.`,
      fieldKeys: ["workspacePreparationCommand"],
    });
  }

  if (args.localCiContract.source === "repo_script_candidate" && args.localCiContract.recommendedCommand !== null) {
    actions.push({
      action: "adopt_local_ci",
      source: "local_ci_candidate",
      priority: 50,
      required: false,
      summary:
        `Optional: adopt the repo-owned local CI command ${args.localCiContract.recommendedCommand} in localCiCommand, or explicitly dismiss the candidate if you do not want codex-supervisor to treat it as the local verification contract.`,
      fieldKeys: ["localCiCommand", "localCiCandidateDismissed"],
    });
    actions.push({
      action: "dismiss_local_ci",
      source: "local_ci_candidate",
      priority: 49,
      required: false,
      summary:
        `Optional: dismiss the repo-owned local CI candidate ${args.localCiContract.recommendedCommand} to keep localCiCommand unset without repeating the adoption prompt.`,
      fieldKeys: ["localCiCandidateDismissed"],
    });
  }

  if (args.localCiContract.source === "dismissed_repo_script_candidate") {
    actions.push({
      action: "safe_to_ignore",
      source: "local_ci_candidate_dismissed",
      priority: 10,
      required: false,
      summary: args.localCiContract.summary,
      fieldKeys: ["localCiCandidateDismissed"],
    });
  }

  for (const group of args.configPostureGroups) {
    if (group.tier !== "dangerous_explicit_opt_in") {
      continue;
    }

    for (const field of group.fields) {
      if (field.state !== "configured") {
        continue;
      }

      actions.push({
        action: "manual_review",
        source: `dangerous_explicit_opt_in:${field.key}`,
        priority: 40,
        required: false,
        summary:
          `Confirm ${field.label} remains an intentional dangerous explicit opt-in; do not treat it as a recommended setup default.`,
        fieldKeys: [field.key],
      });
    }
  }

  if (actions.length === 0) {
    actions.push({
      action: "continue",
      source: "setup_readiness",
      priority: 0,
      required: false,
      summary: "No setup blockers or advisory setup decisions remain; continue normal supervisor operation.",
      fieldKeys: [],
    });
  }

  return sortNextActions(actions);
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
  const configPostureGroups = buildConfigPostureGroups({
    rawConfig,
    configSummary,
    fields,
    modelRoutingPosture,
  });
  const hostDiagnostics = configSummary.config
    ? await diagnoseSupervisorHost({
      config: configSummary.config,
      authStatus: args.authStatus,
    })
    : null;
  const hostReadiness = buildHostReadiness(hostDiagnostics?.checks ?? null, hostDiagnostics?.overallStatus ?? null);
  const blockers = buildBlockers({ fields, hostReadiness, modelRoutingPosture });
  const localCiContract = summarizeLocalCiContract(localCiContractConfig);
  const nextActions = buildNextActions({
    blockers,
    configPostureGroups,
    localCiContract,
    recommendedWorkspacePreparationCommand,
    workspacePreparationCommand: localCiContractConfig.workspacePreparationCommand,
  });

  return {
    kind: "setup_readiness",
    ready: blockers.length === 0,
    overallStatus: overallStatusFromFields(fields, modelRoutingPosture),
    configPath,
    fields,
    configPostureGroups,
    blockers,
    nextActions,
    hostReadiness,
    providerPosture: buildProviderPosture(configSummary.config),
    trustPosture: buildTrustPostureFromRaw(rawConfig, configSummary.config),
    modelRoutingPosture,
    localCiContract,
    localReviewPosture: configSummary.config ? summarizeLocalReviewPosture(configSummary.config) : undefined,
  };
}
