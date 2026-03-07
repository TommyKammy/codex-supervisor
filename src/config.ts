import fs from "node:fs";
import path from "node:path";
import { SupervisorConfig } from "./types";
import { resolveMaybeRelative } from "./utils";

const DEFAULT_CONFIG_FILE = "supervisor.config.json";

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid config field: ${label}`);
  }

  return value;
}

export function resolveConfigPath(configPath?: string): string {
  return configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
}

export function loadConfig(configPath?: string): SupervisorConfig {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as Record<string, unknown>;
  const configDir = path.dirname(resolvedPath);

  return {
    repoPath: resolveMaybeRelative(configDir, assertString(raw.repoPath, "repoPath")),
    repoSlug: assertString(raw.repoSlug, "repoSlug"),
    defaultBranch: assertString(raw.defaultBranch, "defaultBranch"),
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
    codexBinary: resolveMaybeRelative(configDir, assertString(raw.codexBinary, "codexBinary")),
    sharedMemoryFiles: Array.isArray(raw.sharedMemoryFiles)
      ? raw.sharedMemoryFiles.filter((value): value is string => typeof value === "string")
      : [],
    reviewBotLogins: Array.isArray(raw.reviewBotLogins)
      ? raw.reviewBotLogins
          .filter((value): value is string => typeof value === "string" && value.trim() !== "")
          .map((value) => value.toLowerCase())
      : ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge:
      typeof raw.humanReviewBlocksMerge === "boolean"
        ? raw.humanReviewBlocksMerge
        : true,
    issueJournalRelativePath:
      typeof raw.issueJournalRelativePath === "string" && raw.issueJournalRelativePath.trim() !== ""
        ? raw.issueJournalRelativePath
        : ".codex-supervisor/issue-journal.md",
    issueLabel: typeof raw.issueLabel === "string" ? raw.issueLabel : undefined,
    issueSearch: typeof raw.issueSearch === "string" ? raw.issueSearch : undefined,
    skipTitlePrefixes: Array.isArray(raw.skipTitlePrefixes)
      ? raw.skipTitlePrefixes.filter((value): value is string => typeof value === "string")
      : [],
    branchPrefix: assertString(raw.branchPrefix, "branchPrefix"),
    pollIntervalSeconds:
      typeof raw.pollIntervalSeconds === "number" && raw.pollIntervalSeconds > 0
        ? raw.pollIntervalSeconds
        : 120,
    copilotReviewWaitMinutes:
      typeof raw.copilotReviewWaitMinutes === "number" && raw.copilotReviewWaitMinutes >= 0
        ? raw.copilotReviewWaitMinutes
        : 10,
    codexExecTimeoutMinutes:
      typeof raw.codexExecTimeoutMinutes === "number" && raw.codexExecTimeoutMinutes > 0
        ? raw.codexExecTimeoutMinutes
        : 30,
    maxCodexAttemptsPerIssue:
      typeof raw.maxCodexAttemptsPerIssue === "number" && raw.maxCodexAttemptsPerIssue > 0
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
    cleanupDoneWorkspacesAfterHours:
      typeof raw.cleanupDoneWorkspacesAfterHours === "number" && raw.cleanupDoneWorkspacesAfterHours >= 0
        ? raw.cleanupDoneWorkspacesAfterHours
        : 24,
    mergeMethod:
      raw.mergeMethod === "merge" || raw.mergeMethod === "squash" || raw.mergeMethod === "rebase"
        ? raw.mergeMethod
        : "squash",
    draftPrAfterAttempt:
      typeof raw.draftPrAfterAttempt === "number" && raw.draftPrAfterAttempt >= 1
        ? raw.draftPrAfterAttempt
        : 1,
  };
}
