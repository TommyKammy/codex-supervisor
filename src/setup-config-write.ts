import fs from "node:fs/promises";
import path from "node:path";
import {
  displayLocalCiCommand,
  loadConfigSummary,
  normalizeLocalCiCommand as normalizeConfigLocalCiCommand,
  resolveConfigPath,
  validateWorkspacePreparationCommandForWorktrees,
} from "./core/config";
import { reviewProviderProfileFromConfig } from "./core/review-providers";
import { isValidGitRefName, parseJson, resolveMaybeRelative, writeJsonAtomic } from "./core/utils";
import type { ExecutionSafetyMode, TrustMode } from "./core/types";
import type { LocalReviewHighSeverityAction, StaleConfiguredBotReviewPolicy } from "./core/types";
import type { SetupConfigPreviewSelectableReviewProviderProfile } from "./setup-config-preview";
import { diagnoseSetupReadiness, type SetupReadinessFieldKey, type SetupReadinessReport } from "./setup-readiness";

export interface SetupConfigChanges {
  repoPath?: string;
  repoSlug?: string;
  defaultBranch?: string;
  workspaceRoot?: string;
  stateFile?: string;
  codexBinary?: string;
  branchPrefix?: string;
  workspacePreparationCommand?: string | null;
  localCiCommand?: string | null;
  trustMode?: TrustMode;
  executionSafetyMode?: ExecutionSafetyMode;
  localCiCandidateDismissed?: boolean;
  reviewProvider?: SetupConfigPreviewSelectableReviewProviderProfile;
  localReviewFollowUpRepairEnabled?: boolean;
  localReviewManualReviewRepairEnabled?: boolean;
  localReviewFollowUpIssueCreationEnabled?: boolean;
  localReviewHighSeverityAction?: LocalReviewHighSeverityAction;
  staleConfiguredBotReviewPolicy?: StaleConfiguredBotReviewPolicy;
  approvedTrackedTopLevelEntries?: string[] | null;
}

export interface DangerousOptInConfirmation {
  acknowledged: true;
  fieldKeys: DangerousSetupConfigFieldKey[];
}

export interface UpdateSetupConfigArgs {
  configPath?: string;
  changes: SetupConfigChanges;
  dangerousOptInConfirmation?: DangerousOptInConfirmation;
}

export interface SetupConfigUpdateResult {
  kind: "setup_config_update";
  configPath: string;
  backupPath: string | null;
  updatedFields: SetupConfigWritableFieldKey[];
  restartRequired: boolean;
  restartScope: "supervisor" | null;
  restartTriggeredByFields: SetupConfigWritableFieldKey[];
  document: Record<string, unknown>;
  readiness: SetupReadinessReport;
}

type SafeSetupConfigWritableFieldKey = SetupReadinessFieldKey | "localCiCandidateDismissed";
export type DangerousSetupConfigFieldKey =
  | "localReviewFollowUpRepairEnabled"
  | "localReviewManualReviewRepairEnabled"
  | "localReviewFollowUpIssueCreationEnabled"
  | "localReviewHighSeverityAction"
  | "staleConfiguredBotReviewPolicy"
  | "approvedTrackedTopLevelEntries";
type SetupConfigWritableFieldKey = SafeSetupConfigWritableFieldKey | DangerousSetupConfigFieldKey;

export class SetupConfigWriteError extends Error {
  readonly code: "dangerous_confirmation_required";
  readonly dangerousFields: DangerousSetupConfigFieldKey[];

  constructor(message: string, dangerousFields: DangerousSetupConfigFieldKey[]) {
    super(message);
    this.name = "SetupConfigWriteError";
    this.code = "dangerous_confirmation_required";
    this.dangerousFields = dangerousFields;
  }
}

const CONFIGURABLE_FIELDS: SetupConfigWritableFieldKey[] = [
  "repoPath",
  "repoSlug",
  "defaultBranch",
  "workspaceRoot",
  "stateFile",
  "codexBinary",
  "branchPrefix",
  "workspacePreparationCommand",
  "localCiCommand",
  "trustMode",
  "executionSafetyMode",
  "localCiCandidateDismissed",
  "reviewProvider",
];
export const DANGEROUS_SETUP_CONFIG_FIELD_KEYS = [
  "localReviewFollowUpRepairEnabled",
  "localReviewManualReviewRepairEnabled",
  "localReviewFollowUpIssueCreationEnabled",
  "localReviewHighSeverityAction",
  "staleConfiguredBotReviewPolicy",
  "approvedTrackedTopLevelEntries",
] as const satisfies readonly DangerousSetupConfigFieldKey[];
const DANGEROUS_CONFIGURABLE_FIELDS: DangerousSetupConfigFieldKey[] = [...DANGEROUS_SETUP_CONFIG_FIELD_KEYS];
const ALL_CONFIGURABLE_FIELDS = [...CONFIGURABLE_FIELDS, ...DANGEROUS_CONFIGURABLE_FIELDS] as const;

const RESTART_REQUIRED_FIELDS = new Set<string>(ALL_CONFIGURABLE_FIELDS);

const REVIEW_PROVIDER_LOGIN_MAP: Record<SetupConfigPreviewSelectableReviewProviderProfile, string[]> = {
  none: [],
  copilot: ["copilot-pull-request-reviewer"],
  codex: ["chatgpt-codex-connector"],
  coderabbit: ["coderabbitai", "coderabbitai[bot]"],
};
const SETUP_CONFIG_BACKUP_RETENTION = 5;

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function assertRepoSlug(value: unknown): string {
  const normalized = assertNonEmptyString(value, "repoSlug");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) {
    throw new Error("repoSlug must use owner/repo format.");
  }
  return normalized;
}

function assertGitRef(value: unknown, fieldName: "defaultBranch" | "branchPrefix"): string {
  const normalized = assertNonEmptyString(value, fieldName);
  const candidate = fieldName === "branchPrefix" ? `${normalized}1` : normalized;
  if (!isValidGitRefName(candidate)) {
    throw new Error(`${fieldName} must be a valid git ref name.`);
  }
  return normalized;
}

function assertReviewProvider(value: unknown): SetupConfigPreviewSelectableReviewProviderProfile {
  if (value === "none" || value === "copilot" || value === "codex" || value === "coderabbit") {
    return value;
  }

  throw new Error("reviewProvider must be one of none, copilot, codex, or coderabbit.");
}

function assertTrustMode(value: unknown): TrustMode {
  if (value === "trusted_repo_and_authors" || value === "untrusted_or_mixed") {
    return value;
  }

  throw new Error("trustMode must be one of trusted_repo_and_authors or untrusted_or_mixed.");
}

function assertExecutionSafetyMode(value: unknown): ExecutionSafetyMode {
  if (value === "unsandboxed_autonomous" || value === "operator_gated") {
    return value;
  }

  throw new Error("executionSafetyMode must be one of unsandboxed_autonomous or operator_gated.");
}

function assertLocalReviewHighSeverityAction(value: unknown): LocalReviewHighSeverityAction {
  if (value === "retry" || value === "blocked") {
    return value;
  }

  throw new Error("localReviewHighSeverityAction must be one of retry or blocked.");
}

function assertStaleConfiguredBotReviewPolicy(value: unknown): StaleConfiguredBotReviewPolicy {
  if (value === "diagnose_only" || value === "reply_only" || value === "reply_and_resolve") {
    return value;
  }

  throw new Error("staleConfiguredBotReviewPolicy must be one of diagnose_only, reply_only, or reply_and_resolve.");
}

function assertBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function normalizeApprovedTrackedTopLevelEntries(value: unknown): string[] | null {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error("approvedTrackedTopLevelEntries must be an array of top-level entry names or null.");
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`approvedTrackedTopLevelEntries[${index}] must be a non-empty string.`);
    }
    const normalized = entry.trim();
    if (normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
      throw new Error(`approvedTrackedTopLevelEntries[${index}] must be a top-level entry name.`);
    }
    return normalized;
  });
}

function normalizeLocalCiCommand(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("localCiCommand must be a string or null.");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function assertNoConflictingLocalCiIntent(changes: SetupConfigChanges): void {
  if (changes.localCiCandidateDismissed === true && typeof changes.localCiCommand === "string") {
    throw new Error("localCiCommand and localCiCandidateDismissed=true cannot be set in the same update.");
  }
}

function validateProspectiveSetupDocument(configPath: string, nextDocument: Record<string, unknown>): void {
  const configDir = path.dirname(configPath);
  const repoPath =
    typeof nextDocument.repoPath === "string" && nextDocument.repoPath.trim() !== ""
      ? resolveMaybeRelative(configDir, nextDocument.repoPath)
      : undefined;
  const workspacePreparationCommand = normalizeConfigLocalCiCommand(nextDocument.workspacePreparationCommand);
  const validationError = validateWorkspacePreparationCommandForWorktrees({
    repoPath,
    workspacePreparationCommand,
  });
  if (validationError !== null) {
    throw new Error(validationError);
  }
}

function normalizeSetupChanges(changes: unknown): SetupConfigChanges {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new Error("changes must be an object.");
  }

  const raw = changes as Record<string, unknown>;
  const unknownFields = Object.keys(raw).filter((key) => !ALL_CONFIGURABLE_FIELDS.includes(key as (typeof ALL_CONFIGURABLE_FIELDS)[number]));
  if (unknownFields.length > 0) {
    throw new Error(`Unsupported setup config field: ${unknownFields[0]}`);
  }

  const normalized: SetupConfigChanges = {};
  if ("repoPath" in raw) {
    normalized.repoPath = assertNonEmptyString(raw.repoPath, "repoPath");
  }
  if ("repoSlug" in raw) {
    normalized.repoSlug = assertRepoSlug(raw.repoSlug);
  }
  if ("defaultBranch" in raw) {
    normalized.defaultBranch = assertGitRef(raw.defaultBranch, "defaultBranch");
  }
  if ("workspaceRoot" in raw) {
    normalized.workspaceRoot = assertNonEmptyString(raw.workspaceRoot, "workspaceRoot");
  }
  if ("stateFile" in raw) {
    normalized.stateFile = assertNonEmptyString(raw.stateFile, "stateFile");
  }
  if ("codexBinary" in raw) {
    normalized.codexBinary = assertNonEmptyString(raw.codexBinary, "codexBinary");
  }
  if ("branchPrefix" in raw) {
    normalized.branchPrefix = assertGitRef(raw.branchPrefix, "branchPrefix");
  }
  if ("workspacePreparationCommand" in raw) {
    normalized.workspacePreparationCommand = normalizeLocalCiCommand(raw.workspacePreparationCommand);
  }
  if ("localCiCommand" in raw) {
    normalized.localCiCommand = normalizeLocalCiCommand(raw.localCiCommand);
  }
  if ("trustMode" in raw) {
    normalized.trustMode = assertTrustMode(raw.trustMode);
  }
  if ("executionSafetyMode" in raw) {
    normalized.executionSafetyMode = assertExecutionSafetyMode(raw.executionSafetyMode);
  }
  if ("localCiCandidateDismissed" in raw) {
    normalized.localCiCandidateDismissed = assertBoolean(raw.localCiCandidateDismissed, "localCiCandidateDismissed");
  }
  if ("reviewProvider" in raw) {
    normalized.reviewProvider = assertReviewProvider(raw.reviewProvider);
  }
  if ("localReviewFollowUpRepairEnabled" in raw) {
    normalized.localReviewFollowUpRepairEnabled = assertBoolean(
      raw.localReviewFollowUpRepairEnabled,
      "localReviewFollowUpRepairEnabled",
    );
  }
  if ("localReviewManualReviewRepairEnabled" in raw) {
    normalized.localReviewManualReviewRepairEnabled = assertBoolean(
      raw.localReviewManualReviewRepairEnabled,
      "localReviewManualReviewRepairEnabled",
    );
  }
  if ("localReviewFollowUpIssueCreationEnabled" in raw) {
    normalized.localReviewFollowUpIssueCreationEnabled = assertBoolean(
      raw.localReviewFollowUpIssueCreationEnabled,
      "localReviewFollowUpIssueCreationEnabled",
    );
  }
  if ("localReviewHighSeverityAction" in raw) {
    normalized.localReviewHighSeverityAction = assertLocalReviewHighSeverityAction(raw.localReviewHighSeverityAction);
  }
  if ("staleConfiguredBotReviewPolicy" in raw) {
    normalized.staleConfiguredBotReviewPolicy = assertStaleConfiguredBotReviewPolicy(raw.staleConfiguredBotReviewPolicy);
  }
  if ("approvedTrackedTopLevelEntries" in raw) {
    normalized.approvedTrackedTopLevelEntries = normalizeApprovedTrackedTopLevelEntries(raw.approvedTrackedTopLevelEntries);
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error("changes must include at least one supported setup field.");
  }

  assertNoConflictingLocalCiIntent(normalized);

  return normalized;
}

async function readExistingConfigDocument(configPath: string): Promise<{
  document: Record<string, unknown>;
  rawContents: string | null;
}> {
  try {
    const rawContents = await fs.readFile(configPath, "utf8");
    const parsed = parseJson<unknown>(rawContents, configPath);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Config file must contain a JSON object: ${configPath}`);
    }

    return {
      document: parsed as Record<string, unknown>,
      rawContents,
    };
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return {
        document: {},
        rawContents: null,
      };
    }

    throw error;
  }
}

function applySetupChanges(document: Record<string, unknown>, changes: SetupConfigChanges): Record<string, unknown> {
  assertNoConflictingLocalCiIntent(changes);

  const nextDocument = { ...document };
  if (changes.repoPath !== undefined) {
    nextDocument.repoPath = changes.repoPath;
  }
  if (changes.repoSlug !== undefined) {
    nextDocument.repoSlug = changes.repoSlug;
  }
  if (changes.defaultBranch !== undefined) {
    nextDocument.defaultBranch = changes.defaultBranch;
  }
  if (changes.workspaceRoot !== undefined) {
    nextDocument.workspaceRoot = changes.workspaceRoot;
  }
  if (changes.stateFile !== undefined) {
    nextDocument.stateFile = changes.stateFile;
  }
  if (changes.codexBinary !== undefined) {
    nextDocument.codexBinary = changes.codexBinary;
  }
  if (changes.branchPrefix !== undefined) {
    nextDocument.branchPrefix = changes.branchPrefix;
  }
  if ("workspacePreparationCommand" in changes) {
    if (changes.workspacePreparationCommand === null) {
      delete nextDocument.workspacePreparationCommand;
    } else {
      nextDocument.workspacePreparationCommand = changes.workspacePreparationCommand;
    }
  }
  if ("localCiCommand" in changes) {
    if (changes.localCiCommand === null) {
      delete nextDocument.localCiCommand;
    } else {
      nextDocument.localCiCommand = changes.localCiCommand;
      delete nextDocument.localCiCandidateDismissed;
    }
  }
  if (changes.trustMode !== undefined) {
    nextDocument.trustMode = changes.trustMode;
  }
  if (changes.executionSafetyMode !== undefined) {
    nextDocument.executionSafetyMode = changes.executionSafetyMode;
  }
  if ("localCiCandidateDismissed" in changes) {
    if (changes.localCiCandidateDismissed) {
      nextDocument.localCiCandidateDismissed = true;
      delete nextDocument.localCiCommand;
    } else {
      delete nextDocument.localCiCandidateDismissed;
    }
  }
  if (changes.reviewProvider !== undefined) {
    nextDocument.reviewBotLogins = [...REVIEW_PROVIDER_LOGIN_MAP[changes.reviewProvider]];
  }
  if (changes.localReviewFollowUpRepairEnabled !== undefined) {
    nextDocument.localReviewFollowUpRepairEnabled = changes.localReviewFollowUpRepairEnabled;
  }
  if (changes.localReviewManualReviewRepairEnabled !== undefined) {
    nextDocument.localReviewManualReviewRepairEnabled = changes.localReviewManualReviewRepairEnabled;
  }
  if (changes.localReviewFollowUpIssueCreationEnabled !== undefined) {
    nextDocument.localReviewFollowUpIssueCreationEnabled = changes.localReviewFollowUpIssueCreationEnabled;
  }
  if (changes.localReviewHighSeverityAction !== undefined) {
    nextDocument.localReviewHighSeverityAction = changes.localReviewHighSeverityAction;
  }
  if (changes.staleConfiguredBotReviewPolicy !== undefined) {
    nextDocument.staleConfiguredBotReviewPolicy = changes.staleConfiguredBotReviewPolicy;
  }
  if ("approvedTrackedTopLevelEntries" in changes) {
    const approvedEntries = changes.approvedTrackedTopLevelEntries ?? null;
    if (approvedEntries === null || approvedEntries.length === 0) {
      delete nextDocument.approvedTrackedTopLevelEntries;
    } else {
      nextDocument.approvedTrackedTopLevelEntries = [...approvedEntries];
    }
  }
  return nextDocument;
}

function displayStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function displayExactStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function currentSemanticFieldValue(args: {
  configSummary: ReturnType<typeof loadConfigSummary>;
  existingDocument: Record<string, unknown>;
  field: SetupConfigWritableFieldKey | DangerousSetupConfigFieldKey;
}): string | null {
  const { configSummary, existingDocument, field } = args;
  const resolvedConfig = configSummary.config;

  if (field === "reviewProvider") {
    if (resolvedConfig !== null) {
      return reviewProviderProfileFromConfig(resolvedConfig).profile;
    }

    const reviewBotLogins = Array.isArray(existingDocument.reviewBotLogins)
      ? existingDocument.reviewBotLogins.filter((value): value is string => typeof value === "string")
      : [];
    return reviewProviderProfileFromConfig({
      reviewBotLogins,
      configuredReviewProviders: undefined,
    }).profile;
  }

  if (field === "localCiCommand") {
    if (resolvedConfig !== null) {
      return displayLocalCiCommand(resolvedConfig.localCiCommand);
    }

    return displayStringValue(existingDocument.localCiCommand);
  }

  if (field === "workspacePreparationCommand") {
    if (resolvedConfig !== null) {
      return displayLocalCiCommand(resolvedConfig.workspacePreparationCommand);
    }

    return displayStringValue(existingDocument.workspacePreparationCommand);
  }

  if (field === "localCiCandidateDismissed") {
    const currentLocalCiCommand =
      resolvedConfig !== null
        ? displayLocalCiCommand(resolvedConfig.localCiCommand)
        : displayStringValue(existingDocument.localCiCommand);
    const dismissedValue =
      resolvedConfig !== null
        ? resolvedConfig.localCiCandidateDismissed
        : existingDocument.localCiCandidateDismissed;
    const effectiveDismissed = currentLocalCiCommand === null && dismissedValue === true;
    return effectiveDismissed ? "true" : "false";
  }

  if (field === "trustMode" || field === "executionSafetyMode") {
    return displayExactStringValue(existingDocument[field]);
  }

  if (
    field === "localReviewFollowUpRepairEnabled" ||
    field === "localReviewManualReviewRepairEnabled" ||
    field === "localReviewFollowUpIssueCreationEnabled"
  ) {
    const value = existingDocument[field];
    return typeof value === "boolean" ? String(value) : "false";
  }

  if (field === "localReviewHighSeverityAction") {
    return displayExactStringValue(existingDocument.localReviewHighSeverityAction) ?? "blocked";
  }

  if (field === "staleConfiguredBotReviewPolicy") {
    return displayExactStringValue(existingDocument.staleConfiguredBotReviewPolicy) ?? "diagnose_only";
  }

  if (field === "approvedTrackedTopLevelEntries") {
    const value = existingDocument.approvedTrackedTopLevelEntries;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").join("\n") : "";
  }

  if (resolvedConfig !== null) {
    return displayStringValue(resolvedConfig[field]);
  }

  return displayStringValue(existingDocument[field]);
}

function nextSemanticFieldValue(
  field: SetupConfigWritableFieldKey | DangerousSetupConfigFieldKey,
  changes: SetupConfigChanges,
): string | null {
  switch (field) {
    case "repoPath":
      return changes.repoPath ?? null;
    case "repoSlug":
      return changes.repoSlug ?? null;
    case "defaultBranch":
      return changes.defaultBranch ?? null;
    case "workspaceRoot":
      return changes.workspaceRoot ?? null;
    case "stateFile":
      return changes.stateFile ?? null;
    case "codexBinary":
      return changes.codexBinary ?? null;
    case "branchPrefix":
      return changes.branchPrefix ?? null;
    case "workspacePreparationCommand":
      return changes.workspacePreparationCommand ?? null;
    case "localCiCommand":
      return changes.localCiCommand ?? null;
    case "localCiCandidateDismissed":
      return changes.localCiCandidateDismissed === true ? "true" : "false";
    case "trustMode":
      return changes.trustMode ?? null;
    case "executionSafetyMode":
      return changes.executionSafetyMode ?? null;
    case "reviewProvider":
      return changes.reviewProvider ?? null;
    case "localReviewFollowUpRepairEnabled":
      return changes.localReviewFollowUpRepairEnabled === true ? "true" : "false";
    case "localReviewManualReviewRepairEnabled":
      return changes.localReviewManualReviewRepairEnabled === true ? "true" : "false";
    case "localReviewFollowUpIssueCreationEnabled":
      return changes.localReviewFollowUpIssueCreationEnabled === true ? "true" : "false";
    case "localReviewHighSeverityAction":
      return changes.localReviewHighSeverityAction ?? "blocked";
    case "staleConfiguredBotReviewPolicy":
      return changes.staleConfiguredBotReviewPolicy ?? "diagnose_only";
    case "approvedTrackedTopLevelEntries":
      return changes.approvedTrackedTopLevelEntries?.join("\n") ?? "";
  }
}

function dangerousOptInSemanticValueEnabled(field: DangerousSetupConfigFieldKey, value: string | null): boolean {
  switch (field) {
    case "localReviewFollowUpRepairEnabled":
    case "localReviewManualReviewRepairEnabled":
    case "localReviewFollowUpIssueCreationEnabled":
      return value === "true";
    case "localReviewHighSeverityAction":
      return value === "retry";
    case "staleConfiguredBotReviewPolicy":
      return value === "reply_only" || value === "reply_and_resolve";
    case "approvedTrackedTopLevelEntries":
      return value !== null && value.length > 0;
  }
}

function dangerousOptInFieldsEnabledByTransition(args: {
  configSummary: ReturnType<typeof loadConfigSummary>;
  existingDocument: Record<string, unknown>;
  changes: SetupConfigChanges;
}): DangerousSetupConfigFieldKey[] {
  const { configSummary, existingDocument, changes } = args;
  return DANGEROUS_CONFIGURABLE_FIELDS.filter((field) => {
    if (!(field in changes)) {
      return false;
    }

    const nextValue = nextSemanticFieldValue(field, changes);
    if (!dangerousOptInSemanticValueEnabled(field, nextValue)) {
      return false;
    }

    const currentValue = currentSemanticFieldValue({ configSummary, existingDocument, field });
    return !dangerousOptInSemanticValueEnabled(field, currentValue);
  });
}

function assertDangerousOptInConfirmation(args: {
  configSummary: ReturnType<typeof loadConfigSummary>;
  existingDocument: Record<string, unknown>;
  changes: SetupConfigChanges;
  confirmation: DangerousOptInConfirmation | undefined;
}): void {
  const dangerousFields = dangerousOptInFieldsEnabledByTransition({
    configSummary: args.configSummary,
    existingDocument: args.existingDocument,
    changes: args.changes,
  });
  if (dangerousFields.length === 0) {
    return;
  }

  const confirmedFields = new Set(args.confirmation?.fieldKeys ?? []);
  const confirmed = args.confirmation?.acknowledged === true && dangerousFields.every((field) => confirmedFields.has(field));
  if (!confirmed) {
    throw new SetupConfigWriteError(
      `Dangerous explicit opt-in confirmation required for: ${dangerousFields.join(", ")}.`,
      dangerousFields,
    );
  }
}

function determineRestartTriggeredFields(args: {
  configSummary: ReturnType<typeof loadConfigSummary>;
  existingDocument: Record<string, unknown>;
  changes: SetupConfigChanges;
}): Array<SetupConfigWritableFieldKey | DangerousSetupConfigFieldKey> {
  const { configSummary, existingDocument, changes } = args;
  const updatedFields = ALL_CONFIGURABLE_FIELDS.filter((field) => field in changes);
  return updatedFields.filter((field) => {
    if (!RESTART_REQUIRED_FIELDS.has(field)) {
      return false;
    }

    return currentSemanticFieldValue({ configSummary, existingDocument, field }) !== nextSemanticFieldValue(field, changes);
  });
}

async function rotateSetupConfigBackups(backupPath: string): Promise<void> {
  for (let index = SETUP_CONFIG_BACKUP_RETENTION - 1; index >= 1; index -= 1) {
    const destinationPath = `${backupPath}.${index}`;
    if (index === SETUP_CONFIG_BACKUP_RETENTION - 1) {
      await fs.rm(destinationPath, { force: true });
    }

    const sourcePath = index === 1 ? backupPath : `${backupPath}.${index - 1}`;
    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function updateSetupConfig(args: UpdateSetupConfigArgs): Promise<SetupConfigUpdateResult> {
  const configPath = resolveConfigPath(args.configPath);
  const changes = normalizeSetupChanges(args.changes);
  const existing = await readExistingConfigDocument(configPath);
  const configSummary = loadConfigSummary(configPath);
  assertDangerousOptInConfirmation({
    configSummary,
    existingDocument: existing.document,
    changes,
    confirmation: args.dangerousOptInConfirmation,
  });
  const restartTriggeredByFields = determineRestartTriggeredFields({
    configSummary,
    existingDocument: existing.document,
    changes,
  });
  const nextDocument = applySetupChanges(existing.document, changes);
  validateProspectiveSetupDocument(configPath, nextDocument);

  let backupPath: string | null = null;
  if (existing.rawContents !== null) {
    backupPath = `${configPath}.bak`;
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await rotateSetupConfigBackups(backupPath);
    await fs.writeFile(backupPath, existing.rawContents, "utf8");
  }

  await writeJsonAtomic(configPath, nextDocument);
  const readiness = await diagnoseSetupReadiness({ configPath });

  return {
    kind: "setup_config_update",
    configPath,
    backupPath,
    updatedFields: ALL_CONFIGURABLE_FIELDS.filter((field) => field in changes),
    restartRequired: restartTriggeredByFields.length > 0,
    restartScope: restartTriggeredByFields.length > 0 ? "supervisor" : null,
    restartTriggeredByFields,
    document: nextDocument,
    readiness,
  };
}
