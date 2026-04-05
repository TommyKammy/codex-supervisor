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
  reviewProvider?: SetupConfigPreviewSelectableReviewProviderProfile;
}

export interface UpdateSetupConfigArgs {
  configPath?: string;
  changes: SetupConfigChanges;
}

export interface SetupConfigUpdateResult {
  kind: "setup_config_update";
  configPath: string;
  backupPath: string | null;
  updatedFields: SetupReadinessFieldKey[];
  restartRequired: boolean;
  restartScope: "supervisor" | null;
  restartTriggeredByFields: SetupReadinessFieldKey[];
  document: Record<string, unknown>;
  readiness: SetupReadinessReport;
}

const CONFIGURABLE_FIELDS: SetupReadinessFieldKey[] = [
  "repoPath",
  "repoSlug",
  "defaultBranch",
  "workspaceRoot",
  "stateFile",
  "codexBinary",
  "branchPrefix",
  "workspacePreparationCommand",
  "localCiCommand",
  "reviewProvider",
];

const RESTART_REQUIRED_FIELDS = new Set<SetupReadinessFieldKey>(CONFIGURABLE_FIELDS);

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
  const unknownFields = Object.keys(raw).filter((key) => !CONFIGURABLE_FIELDS.includes(key as SetupReadinessFieldKey));
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
  if ("reviewProvider" in raw) {
    normalized.reviewProvider = assertReviewProvider(raw.reviewProvider);
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error("changes must include at least one supported setup field.");
  }

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
    }
  }
  if (changes.reviewProvider !== undefined) {
    nextDocument.reviewBotLogins = [...REVIEW_PROVIDER_LOGIN_MAP[changes.reviewProvider]];
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

function currentSemanticFieldValue(args: {
  configSummary: ReturnType<typeof loadConfigSummary>;
  existingDocument: Record<string, unknown>;
  field: SetupReadinessFieldKey;
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

  if (resolvedConfig !== null) {
    return displayStringValue(resolvedConfig[field]);
  }

  return displayStringValue(existingDocument[field]);
}

function nextSemanticFieldValue(field: SetupReadinessFieldKey, changes: SetupConfigChanges): string | null {
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
    case "reviewProvider":
      return changes.reviewProvider ?? null;
  }
}

function determineRestartTriggeredFields(args: {
  configSummary: ReturnType<typeof loadConfigSummary>;
  existingDocument: Record<string, unknown>;
  changes: SetupConfigChanges;
}): SetupReadinessFieldKey[] {
  const { configSummary, existingDocument, changes } = args;
  const updatedFields = CONFIGURABLE_FIELDS.filter((field) => field in changes);
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
    updatedFields: CONFIGURABLE_FIELDS.filter((field) => field in changes),
    restartRequired: restartTriggeredByFields.length > 0,
    restartScope: restartTriggeredByFields.length > 0 ? "supervisor" : null,
    restartTriggeredByFields,
    document: nextDocument,
    readiness,
  };
}
