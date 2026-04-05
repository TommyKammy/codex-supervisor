import fs from "node:fs";
import path from "node:path";
import {
  displayLocalCiCommand,
  loadConfigSummary,
  normalizeLocalCiCommand,
  resolveConfigPath,
  summarizeLocalCiContract,
  summarizeTrustDiagnostics,
  validateWorkspacePreparationCommandForWorktrees,
} from "./core/config";
import type { LocalCiContractSummary, TrustDiagnosticsSummary } from "./core/types";
import { diagnoseSupervisorHost, type DoctorCheck, type DoctorCheckStatus } from "./doctor";
import { reviewProviderProfileFromConfig } from "./core/review-providers";

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
  | "reviewProvider";

export type SetupReadinessFieldValueType =
  | "directory_path"
  | "repo_slug"
  | "git_ref"
  | "file_path"
  | "executable_path"
  | "text"
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
  fieldKeys: SetupReadinessFieldKey[];
}

export interface SetupReadinessBlocker {
  code: string;
  message: string;
  fieldKeys: SetupReadinessFieldKey[];
  remediation: SetupReadinessRemediation;
}

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
  summary: string;
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
  localCiContract?: LocalCiContractSummary;
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
  reviewProvider: { source: "config", editable: true, valueType: "review_provider" },
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

function tryNormalizeLocalCiCommand(value: unknown): ReturnType<typeof normalizeLocalCiCommand> {
  try {
    return normalizeLocalCiCommand(value);
  } catch {
    return undefined;
  }
}

function buildFieldMessage(field: SetupReadinessField, workspacePreparationWarning: string | null): string {
  if (field.key === "workspacePreparationCommand") {
    if (workspacePreparationWarning !== null && field.state === "invalid") {
      return workspacePreparationWarning;
    }

    if (field.state === "configured") {
      return "Workspace preparation command is configured.";
    }

    return "Workspace preparation command is optional until you opt in to the repo-owned contract.";
  }

  if (field.key === "localCiCommand") {
    if (field.state === "configured") {
      return "Local CI command is configured.";
    }

    return "Local CI command is optional until you opt in to the repo-owned contract.";
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
}): SetupReadinessField[] {
  const { rawConfig, configSummary, workspacePreparationWarning } = args;
  const resolvedConfig = configSummary.config;
  const fields = SETUP_FIELD_DEFINITIONS.map(({ key, label, required }) => {
    const resolvedValue = resolvedConfig !== null ? displayValue(resolvedConfig[key]) : displayValue(rawConfig?.[key]);
    const state: SetupFieldState = key === "workspacePreparationCommand" && workspacePreparationWarning !== null
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
      message: buildFieldMessage(field, workspacePreparationWarning),
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

function buildTrustPosture(config: ReturnType<typeof loadConfigSummary>["config"]): SetupReadinessTrustPosture {
  const trust = summarizeTrustDiagnostics(
    config ?? {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    },
  );

  return {
    ...trust,
    summary:
      trust.warning === null
        ? "Trust posture avoids the default unsandboxed trusted-input assumption."
        : "Trusted inputs with unsandboxed autonomous execution.",
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

  return blockers;
}

function overallStatusFromFields(fields: SetupReadinessField[]): SetupReadinessOverallStatus {
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
    repoPath: fallbackRepoPath,
  };
  const workspacePreparationWarning = validateWorkspacePreparationCommandForWorktrees(localCiContractConfig);
  const fields = buildConfigFields({
    rawConfig,
    configSummary,
    workspacePreparationWarning,
  });
  const hostDiagnostics = configSummary.config
    ? await diagnoseSupervisorHost({
      config: configSummary.config,
      authStatus: args.authStatus,
    })
    : null;
  const hostReadiness = buildHostReadiness(hostDiagnostics?.checks ?? null, hostDiagnostics?.overallStatus ?? null);
  const blockers = buildBlockers({ fields, hostReadiness });

  return {
    kind: "setup_readiness",
    ready: blockers.length === 0,
    overallStatus: overallStatusFromFields(fields),
    configPath,
    fields,
    blockers,
    hostReadiness,
    providerPosture: buildProviderPosture(configSummary.config),
    trustPosture: buildTrustPosture(configSummary.config),
    localCiContract: summarizeLocalCiContract(localCiContractConfig),
  };
}
