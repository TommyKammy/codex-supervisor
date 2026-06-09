import {
  CONFIG_FIELD_POSTURE_METADATA,
  CONFIG_FIELD_POSTURE_TIERS,
  buildStarterProfilePlaceholderFieldMessage,
  type ConfigFieldName,
  type ConfigFieldPostureMetadata,
  type ConfigFieldPostureTier,
  displayLocalCiCommand,
  type loadConfigSummary,
} from "./core/config";
import type { ExecutionSafetyMode, TrustMode } from "./core/types";
import type {
  SetupFieldState,
  SetupReadinessConfigPostureField,
  SetupReadinessConfigPostureGroup,
  SetupReadinessField,
  SetupReadinessFieldKey,
  SetupReadinessFieldMetadata,
  SetupReadinessModelRoutingPosture,
} from "./setup-readiness";

export type RawConfigDocument = Record<string, unknown> | null;

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

function buildFieldMessage(args: {
  field: SetupReadinessField;
  workspacePreparationWarning: string | null;
  recommendedWorkspacePreparationCommand: string | null;
  starterPlaceholderMessage: string | null;
}): string {
  const { field, workspacePreparationWarning, recommendedWorkspacePreparationCommand, starterPlaceholderMessage } = args;
  if (starterPlaceholderMessage !== null) {
    return starterPlaceholderMessage;
  }

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

export function buildConfigFields(args: {
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
      message: buildFieldMessage({
        field,
        workspacePreparationWarning,
        recommendedWorkspacePreparationCommand,
        starterPlaceholderMessage: buildStarterProfilePlaceholderFieldMessage(key, rawValue),
      }),
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

export function buildConfigPostureGroups(args: {
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
