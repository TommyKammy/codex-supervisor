import fs from "node:fs";
import path from "node:path";
import { SupervisorConfig, type TrustDiagnosticsSummary } from "./types";
import { parseJson } from "./utils";
import { DEFAULT_CONFIG_FILE } from "./config-constants";
import {
  CONFIG_FIELD_POSTURE_METADATA,
  CONFIG_FIELD_POSTURE_TIERS,
  getConfigFieldPostureMetadata,
} from "./config-field-posture";
import { parseSupervisorConfigDocument, normalizeLocalCiCommand, displayLocalCiCommand } from "./config-parsing";
import {
  buildMissingWorkspacePreparationContractWarning,
  collectMissingRequiredFields,
  extractInvalidFieldName,
  extractRepoRelativeWorkspacePreparationHelper,
  MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING,
  validateParsedConfig,
  validateWorkspacePreparationCommandForWorktrees,
} from "./config-validation";
import {
  DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW,
  findRepoOwnedWorkspacePreparationCandidate,
  LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
  PREFERRED_ISSUE_JOURNAL_RELATIVE_PATH,
  summarizeCadenceDiagnostics,
  summarizeLocalCiContract,
  summarizeTrustDiagnostics,
  summarizeWorkspacePreparationContract,
} from "./config-diagnostics";

export {
  buildMissingWorkspacePreparationContractWarning,
  CONFIG_FIELD_POSTURE_METADATA,
  CONFIG_FIELD_POSTURE_TIERS,
  DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW,
  displayLocalCiCommand,
  extractRepoRelativeWorkspacePreparationHelper,
  findRepoOwnedWorkspacePreparationCandidate,
  getConfigFieldPostureMetadata,
  LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
  MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING,
  normalizeLocalCiCommand,
  PREFERRED_ISSUE_JOURNAL_RELATIVE_PATH,
  summarizeCadenceDiagnostics,
  summarizeLocalCiContract,
  summarizeTrustDiagnostics,
  summarizeWorkspacePreparationContract,
  validateWorkspacePreparationCommandForWorktrees,
};

export type {
  ConfigFieldName,
  ConfigFieldPostureMetadata,
  ConfigFieldPostureTier,
  ConfigFieldRequirementScope,
} from "./config-field-posture";

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
    validateParsedConfig(config);
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

export function resolveConfigPath(configPath?: string): string {
  if (configPath) {
    return path.resolve(configPath);
  }

  const envConfigPath = process.env.CODEX_SUPERVISOR_CONFIG?.trim();
  if (envConfigPath) {
    return path.resolve(envConfigPath);
  }

  return path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
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
  const config = parseSupervisorConfigDocument(raw, resolvedPath);
  validateParsedConfig(config);
  return config;
}
