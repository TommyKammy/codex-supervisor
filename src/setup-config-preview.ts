import fs from "node:fs";
import path from "node:path";
import { loadConfigSummaryFromDocument, resolveConfigPath, type ConfigLoadStatus } from "./core/config";
import { getConfigFieldPostureMetadata, type ConfigFieldName } from "./core/config-field-posture";
import { reviewProviderProfileFromConfig, type ReviewProviderProfileId } from "./core/review-providers";
import type { SetupReadinessFieldKey } from "./setup-readiness";

export type SetupConfigPreviewSelectableReviewProviderProfile = Exclude<ReviewProviderProfileId, "custom">;
export type SetupConfigPreviewSource = "existing_config" | "scaffold_default" | "selected_review_provider_profile";
export type SetupConfigPreviewFieldState = "unchanged" | "suggested";
type SetupConfigPreviewFieldKey = Exclude<SetupReadinessFieldKey, "localCiCommand" | "workspacePreparationCommand">;

export interface SetupConfigPreviewSupportedProfile {
  id: SetupConfigPreviewSelectableReviewProviderProfile;
  label: string;
  reviewBotLogins: string[];
}

export interface SetupConfigPreviewFieldChange {
  key: SetupReadinessFieldKey;
  label: string;
  currentValue: unknown;
  previewValue: unknown;
  source: SetupConfigPreviewSource;
  state: SetupConfigPreviewFieldState;
  summary: string;
}

export interface SetupConfigPreviewDangerousOptIn {
  key: ConfigFieldName;
  label: string;
  currentValue: unknown;
  previewValue: unknown;
  state: SetupConfigPreviewFieldState;
  requiresConfirmation: true;
  operatorImpact: string;
}

export interface SetupConfigPreviewValidation {
  status: ConfigLoadStatus;
  missingRequiredFields: string[];
  invalidFields: string[];
  error: string | null;
}

export interface SetupConfigPreview {
  kind: "setup_config_preview";
  mode: "scaffold" | "patch";
  configPath: string;
  writesConfig: false;
  selectedReviewProviderProfile: ReviewProviderProfileId;
  supportedReviewProviderProfiles: SetupConfigPreviewSupportedProfile[];
  preservedUnknownFields: string[];
  document: Record<string, unknown>;
  fieldChanges: SetupConfigPreviewFieldChange[];
  dangerousExplicitOptIns: SetupConfigPreviewDangerousOptIn[];
  validation: SetupConfigPreviewValidation;
}

export interface BuildSetupConfigPreviewArgs {
  configPath?: string;
  reviewProviderProfile?: SetupConfigPreviewSelectableReviewProviderProfile;
}

const ROOT_DIR = path.resolve(__dirname, "..");
const KNOWN_CONFIG_KEYS = new Set([
  "repoPath",
  "repoSlug",
  "defaultBranch",
  "workspaceRoot",
  "stateBackend",
  "stateFile",
  "stateBootstrapFile",
  "codexBinary",
  "trustMode",
  "executionSafetyMode",
  "codexModelStrategy",
  "codexModel",
  "boundedRepairModelStrategy",
  "boundedRepairModel",
  "localReviewModelStrategy",
  "localReviewModel",
  "codexReasoningEffortByState",
  "codexReasoningEscalateOnRepeatedFailure",
  "sharedMemoryFiles",
  "gsdEnabled",
  "gsdAutoInstall",
  "gsdInstallScope",
  "gsdCodexConfigDir",
  "gsdPlanningFiles",
  "localReviewEnabled",
  "localReviewAutoDetect",
  "localReviewRoles",
  "localReviewArtifactDir",
  "localReviewConfidenceThreshold",
  "localReviewReviewerThresholds",
  "localReviewPolicy",
  "trackedPrCurrentHeadLocalReviewRequired",
  "localReviewHighSeverityAction",
  "reviewBotLogins",
  "configuredReviewProviders",
  "humanReviewBlocksMerge",
  "issueJournalRelativePath",
  "issueJournalMaxChars",
  "issueLabel",
  "localCiCommand",
  "issueSearch",
  "candidateDiscoveryFetchWindow",
  "skipTitlePrefixes",
  "branchPrefix",
  "pollIntervalSeconds",
  "mergeCriticalRecheckSeconds",
  "copilotReviewWaitMinutes",
  "copilotReviewTimeoutAction",
  "configuredBotRateLimitWaitMinutes",
  "configuredBotInitialGraceWaitSeconds",
  "configuredBotSettledWaitSeconds",
  "codexExecTimeoutMinutes",
  "maxCodexAttemptsPerIssue",
  "maxImplementationAttemptsPerIssue",
  "maxRepairAttemptsPerIssue",
  "timeoutRetryLimit",
  "blockedVerificationRetryLimit",
  "sameBlockerRepeatLimit",
  "sameFailureSignatureRepeatLimit",
  "maxDoneWorkspaces",
  "cleanupDoneWorkspacesAfterHours",
  "cleanupOrphanedWorkspacesAfterHours",
  "mergeMethod",
  "draftPrAfterAttempt",
]);
const SETUP_FIELD_LABELS: Record<SetupConfigPreviewFieldKey, string> = {
  repoPath: "Repository path",
  repoSlug: "Repository slug",
  defaultBranch: "Default branch",
  workspaceRoot: "Workspace root",
  stateFile: "State file",
  codexBinary: "Codex binary",
  branchPrefix: "Branch prefix",
  trustMode: "Trust mode",
  executionSafetyMode: "Execution safety mode",
  reviewProvider: "Review provider",
};
const DANGEROUS_EXPLICIT_OPT_IN_IMPACTS: Record<string, string> = {
  localReviewFollowUpRepairEnabled:
    "Allows same-PR automated repair for local-review follow-up findings that would otherwise stay advisory.",
  localReviewManualReviewRepairEnabled:
    "Allows same-PR automated repair for manual-review-blocked local-review findings when GitHub is otherwise clear.",
  localReviewFollowUpIssueCreationEnabled:
    "Allows automatic follow-up issue creation for eligible residual local-review findings.",
  localReviewHighSeverityAction:
    "Can route verifier-confirmed high-severity local-review findings into another repair pass instead of blocking.",
  staleConfiguredBotReviewPolicy:
    "Can let the supervisor reply to or resolve stale configured-bot review threads.",
  approvedTrackedTopLevelEntries:
    "Approves tracked top-level repository skeleton entries that the path-safety guard would otherwise flag.",
};
const SUPPORTED_REVIEW_PROVIDER_PROFILES: SetupConfigPreviewSupportedProfile[] = [
  {
    id: "none",
    label: "No provider selected yet",
    reviewBotLogins: [],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  },
  {
    id: "codex",
    label: "Codex Connector",
    reviewBotLogins: ["chatgpt-codex-connector"],
  },
  {
    id: "coderabbit",
    label: "CodeRabbit",
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
  },
];
const REVIEW_PROVIDER_OVERRIDES: Record<SetupConfigPreviewSelectableReviewProviderProfile, Record<string, unknown>> = {
  none: {
    reviewBotLogins: [],
  },
  copilot: {
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  },
  codex: {
    reviewBotLogins: ["chatgpt-codex-connector"],
  },
  coderabbit: {
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    configuredBotRateLimitWaitMinutes: 30,
    configuredBotInitialGraceWaitSeconds: 90,
    configuredBotSettledWaitSeconds: 5,
  },
};

function parseObjectFile(filePath: string): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected ${filePath} to contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function baseScaffoldDocument(): Record<string, unknown> {
  const scaffold = parseObjectFile(path.join(ROOT_DIR, "supervisor.config.example.json"));
  return {
    ...scaffold,
    reviewBotLogins: [],
  };
}

function readRawConfigDocument(configPath: string): Record<string, unknown> | null {
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

function inferReviewProviderProfile(document: Record<string, unknown>): ReviewProviderProfileId {
  const reviewBotLogins = Array.isArray(document.reviewBotLogins)
    ? document.reviewBotLogins.filter((value): value is string => typeof value === "string")
    : [];
  return reviewProviderProfileFromConfig({ reviewBotLogins }).profile;
}

function summarizeFieldChange(args: {
  label: string;
  source: SetupConfigPreviewSource;
  state: SetupConfigPreviewFieldState;
  selectedReviewProviderProfile: ReviewProviderProfileId;
}): string {
  const { label, source, state, selectedReviewProviderProfile } = args;
  if (state === "unchanged") {
    return `Keeps the existing ${label.toLowerCase()} value.`;
  }
  if (source === "selected_review_provider_profile") {
    const selectedProfile = SUPPORTED_REVIEW_PROVIDER_PROFILES.find((profile) => profile.id === selectedReviewProviderProfile);
    return `Applies the ${selectedProfile?.label ?? "selected"} review provider profile.`;
  }
  return `Adds the scaffold value for ${label.toLowerCase()}.`;
}

function buildFieldChanges(args: {
  rawDocument: Record<string, unknown> | null;
  previewDocument: Record<string, unknown>;
  selectedReviewProviderProfile: ReviewProviderProfileId;
}): SetupConfigPreviewFieldChange[] {
  const { rawDocument, previewDocument, selectedReviewProviderProfile } = args;
  const keys: SetupConfigPreviewFieldKey[] = [
    "repoPath",
    "repoSlug",
    "defaultBranch",
    "workspaceRoot",
    "stateFile",
    "codexBinary",
    "branchPrefix",
    "trustMode",
    "executionSafetyMode",
    "reviewProvider",
  ];

  return keys.map((key) => {
    const currentValue = key === "reviewProvider" ? rawDocument?.reviewBotLogins ?? null : rawDocument?.[key] ?? null;
    const previewValue = key === "reviewProvider" ? previewDocument.reviewBotLogins ?? [] : previewDocument[key] ?? null;
    const usesSelectedProfile =
      key === "reviewProvider" &&
      selectedReviewProviderProfile !== "custom" &&
      JSON.stringify(currentValue) !== JSON.stringify(previewValue);
    const source: SetupConfigPreviewSource =
      currentValue !== null && !(Array.isArray(currentValue) && currentValue.length === 0)
        ? "existing_config"
        : usesSelectedProfile
          ? "selected_review_provider_profile"
          : "scaffold_default";
    const state: SetupConfigPreviewFieldState =
      JSON.stringify(currentValue) === JSON.stringify(previewValue) ? "unchanged" : "suggested";
    return {
      key,
      label: SETUP_FIELD_LABELS[key],
      currentValue,
      previewValue,
      source,
      state,
      summary: summarizeFieldChange({
        label: SETUP_FIELD_LABELS[key],
        source,
        state,
        selectedReviewProviderProfile,
      }),
    };
  });
}

function buildDangerousExplicitOptIns(args: {
  rawDocument: Record<string, unknown> | null;
  previewDocument: Record<string, unknown>;
}): SetupConfigPreviewDangerousOptIn[] {
  const { rawDocument, previewDocument } = args;
  return Object.keys(DANGEROUS_EXPLICIT_OPT_IN_IMPACTS).map((key) => {
    const posture = getConfigFieldPostureMetadata(key);
    const currentValue = rawDocument?.[key] ?? null;
    const previewValue = previewDocument[key] ?? null;
    return {
      key: key as ConfigFieldName,
      label: posture?.summary ?? key,
      currentValue,
      previewValue,
      state: JSON.stringify(currentValue) === JSON.stringify(previewValue) ? "unchanged" : "suggested",
      requiresConfirmation: true,
      operatorImpact: DANGEROUS_EXPLICIT_OPT_IN_IMPACTS[key] ?? "Enables a dangerous explicit opt-in.",
    };
  });
}

export function buildSetupConfigPreview(args: BuildSetupConfigPreviewArgs = {}): SetupConfigPreview {
  const configPath = resolveConfigPath(args.configPath);
  const rawDocument = readRawConfigDocument(configPath);
  const selectedReviewProviderProfile = args.reviewProviderProfile ?? inferReviewProviderProfile(rawDocument ?? {});
  const previewDocument = {
    ...baseScaffoldDocument(),
    ...(rawDocument ?? {}),
    ...(selectedReviewProviderProfile === "custom" ? {} : REVIEW_PROVIDER_OVERRIDES[selectedReviewProviderProfile]),
  };
  const validation = loadConfigSummaryFromDocument(previewDocument, configPath);

  return {
    kind: "setup_config_preview",
    mode: rawDocument ? "patch" : "scaffold",
    configPath,
    writesConfig: false,
    selectedReviewProviderProfile,
    supportedReviewProviderProfiles: SUPPORTED_REVIEW_PROVIDER_PROFILES,
    preservedUnknownFields: Object.keys(rawDocument ?? {}).filter((key) => !KNOWN_CONFIG_KEYS.has(key)).sort(),
    document: previewDocument,
    fieldChanges: buildFieldChanges({
      rawDocument,
      previewDocument,
      selectedReviewProviderProfile,
    }),
    dangerousExplicitOptIns: buildDangerousExplicitOptIns({
      rawDocument,
      previewDocument,
    }),
    validation: {
      status: validation.status,
      missingRequiredFields: validation.missingRequiredFields,
      invalidFields: validation.invalidFields,
      error: validation.error,
    },
  };
}
