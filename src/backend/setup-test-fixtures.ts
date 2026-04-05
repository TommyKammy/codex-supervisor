import { unavailableManagedRestartCapability, type ManagedRestartCapability } from "../managed-restart";
import type {
  SetupConfigPreview,
  SetupConfigPreviewFieldChange,
  SetupConfigPreviewSupportedProfile,
  SetupConfigPreviewValidation,
} from "../setup-config-preview";
import type { SetupConfigUpdateResult } from "../setup-config-write";
import type {
  SetupReadinessBlocker,
  SetupReadinessField,
  SetupReadinessFieldKey,
  SetupReadinessHostSummary,
  SetupReadinessProviderPosture,
  SetupReadinessReport,
  SetupReadinessTrustPosture,
} from "../setup-readiness";

const DEFAULT_CONFIG_PATH = "/tmp/supervisor.config.json";

const DEFAULT_SETUP_DOCUMENT = {
  repoPath: ".",
  repoSlug: "owner/repo",
  defaultBranch: "main",
  workspaceRoot: "/tmp/worktrees",
  stateFile: "/tmp/state.json",
  codexBinary: "codex",
  branchPrefix: "codex/issue-",
  reviewBotLogins: ["chatgpt-codex-connector"],
  experimentalFlag: true,
};

const DEFAULT_SUPPORTED_REVIEW_PROVIDER_PROFILES: SetupConfigPreviewSupportedProfile[] = [
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

const DEFAULT_CONFIG_PREVIEW_VALIDATION: SetupConfigPreviewValidation = {
  status: "ready",
  missingRequiredFields: [],
  invalidFields: [],
  error: null,
};

function cloneReviewBotLogins(reviewBotLogins: string[]): string[] {
  return [...reviewBotLogins];
}

function cloneSupportedReviewProviderProfiles(
  profiles: SetupConfigPreviewSupportedProfile[],
): SetupConfigPreviewSupportedProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    reviewBotLogins: cloneReviewBotLogins(profile.reviewBotLogins),
  }));
}

function cloneSetupConfigPreviewValidation(
  validation: SetupConfigPreviewValidation,
): SetupConfigPreviewValidation {
  return {
    ...validation,
    missingRequiredFields: [...validation.missingRequiredFields],
    invalidFields: [...validation.invalidFields],
  };
}

function cloneSetupDocumentRecord(document: Record<string, unknown>): Record<string, unknown> {
  const reviewBotLogins = document.reviewBotLogins;
  return {
    ...document,
    reviewBotLogins: Array.isArray(reviewBotLogins) ? [...reviewBotLogins] : reviewBotLogins,
  };
}

const DEFAULT_SETUP_FIELD_FIXTURES: Record<SetupReadinessFieldKey, Omit<SetupReadinessField, "key">> = {
  repoPath: {
    label: "Repository path",
    state: "configured",
    value: "/tmp/repo",
    message: "Repository path is configured.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "directory_path",
    },
  },
  repoSlug: {
    label: "Repository slug",
    state: "configured",
    value: "owner/repo",
    message: "Repository slug is configured.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "repo_slug",
    },
  },
  defaultBranch: {
    label: "Default branch",
    state: "configured",
    value: "main",
    message: "Default branch is configured.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "git_ref",
    },
  },
  workspaceRoot: {
    label: "Workspace root",
    state: "configured",
    value: "/tmp/worktrees",
    message: "Workspace root is configured.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "directory_path",
    },
  },
  stateFile: {
    label: "State file",
    state: "configured",
    value: "/tmp/state.json",
    message: "State file is configured.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "file_path",
    },
  },
  codexBinary: {
    label: "Codex binary",
    state: "configured",
    value: "codex",
    message: "Codex binary is configured.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "executable_path",
    },
  },
  branchPrefix: {
    label: "Branch prefix",
    state: "configured",
    value: "codex/issue-",
    message: "Branch prefix is configured.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "text",
    },
  },
  workspacePreparationCommand: {
    label: "Workspace preparation command",
    state: "missing",
    value: null,
    message: "Workspace preparation command is optional until you opt in to the repo-owned contract.",
    required: false,
    metadata: {
      source: "config",
      editable: true,
      valueType: "text",
    },
  },
  localCiCommand: {
    label: "Local CI command",
    state: "missing",
    value: null,
    message: "Local CI command is optional until you opt in to the repo-owned contract.",
    required: false,
    metadata: {
      source: "config",
      editable: true,
      valueType: "text",
    },
  },
  reviewProvider: {
    label: "Review provider",
    state: "missing",
    value: null,
    message: "Configure at least one review provider before first-run setup is complete.",
    required: true,
    metadata: {
      source: "config",
      editable: true,
      valueType: "review_provider",
    },
  },
};

export function createUnavailableManagedRestart(overrides: Partial<ManagedRestartCapability> = {}): ManagedRestartCapability {
  return {
    ...unavailableManagedRestartCapability(),
    ...overrides,
  };
}

export function withManagedRestart<T extends object>(
  payload: T,
  managedRestart: ManagedRestartCapability = createUnavailableManagedRestart(),
): T & { managedRestart: ManagedRestartCapability } {
  return {
    ...payload,
    managedRestart,
  };
}

export function createSetupField(
  key: SetupReadinessFieldKey,
  overrides: Partial<SetupReadinessField> = {},
): SetupReadinessField {
  const field = {
    key,
    ...DEFAULT_SETUP_FIELD_FIXTURES[key],
    ...overrides,
  };
  return {
    ...field,
    metadata: { ...field.metadata },
  };
}

export function createMissingReviewProviderBlocker(
  overrides: Partial<SetupReadinessBlocker> = {},
): SetupReadinessBlocker {
  return {
    code: "missing_review_provider",
    message: "Configure at least one review provider before first-run setup is complete.",
    fieldKeys: ["reviewProvider"],
    remediation: {
      kind: "configure_review_provider",
      summary: "Configure at least one review provider before first-run setup is complete.",
      fieldKeys: ["reviewProvider"],
    },
    ...overrides,
  };
}

export function createSetupHostReadiness(
  overrides: Partial<SetupReadinessHostSummary> = {},
): SetupReadinessHostSummary {
  return {
    overallStatus: "pass",
    checks: [
      {
        name: "github_auth",
        status: "pass",
        summary: "GitHub auth ok.",
        details: [],
      },
    ],
    ...overrides,
  };
}

export function createSetupProviderPosture(
  overrides: Partial<SetupReadinessProviderPosture> = {},
): SetupReadinessProviderPosture {
  return {
    profile: "none",
    provider: "none",
    reviewers: [],
    signalSource: "none",
    configured: false,
    summary: "No review provider is configured.",
    ...overrides,
  };
}

export function createSetupTrustPosture(
  overrides: Partial<SetupReadinessTrustPosture> = {},
): SetupReadinessTrustPosture {
  return {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
    summary: "Trusted inputs with unsandboxed autonomous execution.",
    ...overrides,
  };
}

export function createSetupReadinessReport(
  overrides: Partial<SetupReadinessReport> = {},
): SetupReadinessReport {
  return {
    kind: "setup_readiness",
    ready: false,
    overallStatus: "missing",
    configPath: DEFAULT_CONFIG_PATH,
    fields: [
      createSetupField("repoPath"),
      createSetupField("repoSlug"),
      createSetupField("workspaceRoot"),
      createSetupField("reviewProvider"),
    ],
    blockers: [createMissingReviewProviderBlocker()],
    hostReadiness: createSetupHostReadiness(),
    providerPosture: createSetupProviderPosture(),
    trustPosture: createSetupTrustPosture(),
    ...overrides,
  };
}

export function createSetupDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return cloneSetupDocumentRecord({
    ...DEFAULT_SETUP_DOCUMENT,
    ...overrides,
  });
}

export function createSetupConfigPreviewFieldChange(
  overrides: Partial<SetupConfigPreviewFieldChange> = {},
): SetupConfigPreviewFieldChange {
  return {
    key: "reviewProvider",
    label: "Review provider",
    currentValue: null,
    previewValue: ["chatgpt-codex-connector"],
    source: "selected_review_provider_profile",
    state: "suggested",
    summary: "Applies the Codex Connector review provider profile.",
    ...overrides,
  };
}

export function createSetupConfigPreview(
  overrides: Partial<SetupConfigPreview> = {},
): SetupConfigPreview {
  const preview = {
    kind: "setup_config_preview" as const,
    mode: "patch" as const,
    configPath: DEFAULT_CONFIG_PATH,
    writesConfig: false as const,
    selectedReviewProviderProfile: "codex" as const,
    supportedReviewProviderProfiles: DEFAULT_SUPPORTED_REVIEW_PROVIDER_PROFILES,
    preservedUnknownFields: ["experimentalFlag"],
    document: createSetupDocument(),
    fieldChanges: [createSetupConfigPreviewFieldChange()],
    validation: DEFAULT_CONFIG_PREVIEW_VALIDATION,
    ...overrides,
  };
  return {
    ...preview,
    supportedReviewProviderProfiles: cloneSupportedReviewProviderProfiles(preview.supportedReviewProviderProfiles),
    document: cloneSetupDocumentRecord(preview.document),
    validation: cloneSetupConfigPreviewValidation(preview.validation),
  };
}

export function createSetupConfigUpdateResult(
  overrides: Partial<SetupConfigUpdateResult> = {},
): SetupConfigUpdateResult {
  return {
    kind: "setup_config_update",
    configPath: DEFAULT_CONFIG_PATH,
    backupPath: `${DEFAULT_CONFIG_PATH}.bak`,
    updatedFields: ["reviewProvider"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["reviewProvider"],
    document: createSetupDocument(),
    readiness: createSetupReadinessReport(),
    ...overrides,
  };
}
