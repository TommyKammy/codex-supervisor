import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { LocalCiCommandConfig, SupervisorConfig } from "./config-types";
import { displayLocalCiCommand } from "./config-parsing";

export const MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING =
  "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.";

const REQUIRED_STRING_CONFIG_FIELDS = [
  "repoPath",
  "repoSlug",
  "defaultBranch",
  "workspaceRoot",
  "stateFile",
  "codexBinary",
  "branchPrefix",
] as const;

const STARTER_PROFILE_PLACEHOLDERS: Record<string, Set<string>> = {
  repoPath: new Set(["/absolute/path/to/managed-repo"]),
  repoSlug: new Set(["OWNER/REPO", "REPLACE_ME"]),
  workspaceRoot: new Set(["/absolute/path/to/worktrees"]),
  codexBinary: new Set(["/absolute/path/to/codex"]),
};

const WORKSPACE_PREPARATION_SCRIPT_RUNNERS = new Set(["bash", "sh", "node", "bun", "deno", "python", "python3", "ruby", "tsx", "ts-node"]);

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function collectMissingRequiredFields(raw: Record<string, unknown>): string[] {
  const missing = REQUIRED_STRING_CONFIG_FIELDS.filter((field) => !hasNonEmptyString(raw[field])) as string[];
  if ((raw.codexModelStrategy === "fixed" || raw.codexModelStrategy === "alias") && !hasNonEmptyString(raw.codexModel)) {
    missing.push("codexModel");
  }
  if (
    (raw.boundedRepairModelStrategy === "fixed" || raw.boundedRepairModelStrategy === "alias") &&
    !hasNonEmptyString(raw.boundedRepairModel)
  ) {
    missing.push("boundedRepairModel");
  }
  if (
    (raw.localReviewModelStrategy === "fixed" || raw.localReviewModelStrategy === "alias") &&
    !hasNonEmptyString(raw.localReviewModel)
  ) {
    missing.push("localReviewModel");
  }

  return missing;
}

export function isStarterProfilePlaceholder(field: string, value: unknown): boolean {
  return typeof value === "string" && (STARTER_PROFILE_PLACEHOLDERS[field]?.has(value.trim()) ?? false);
}

export function collectStarterProfilePlaceholderFields(raw: Record<string, unknown>): string[] {
  return REQUIRED_STRING_CONFIG_FIELDS.filter((field) => isStarterProfilePlaceholder(field, raw[field])) as string[];
}

export function buildStarterProfilePlaceholderFieldMessage(field: string, value: unknown): string | null {
  if (!isStarterProfilePlaceholder(field, value)) {
    return null;
  }

  switch (field) {
    case "repoPath":
      return "Repository path still contains a starter placeholder. Replace it with the absolute path to the managed repository.";
    case "repoSlug":
      return "Repository slug still contains a starter placeholder. Replace it with the GitHub owner/repo slug for the managed repository.";
    case "workspaceRoot":
      return "Workspace root still contains a starter placeholder. Replace it with the directory where issue worktrees should be created.";
    case "codexBinary":
      return "Codex binary still contains a starter placeholder. Replace it with a PATH command such as codex or the path to the Codex executable.";
    default:
      return `${field} still contains a starter placeholder. Replace it before running the supervisor.`;
  }
}

export function buildStarterProfilePlaceholderError(raw: Record<string, unknown>, fields: string[]): string {
  const details = fields
    .map((field) => buildStarterProfilePlaceholderFieldMessage(field, raw[field]) ?? `${field} still contains a starter placeholder.`)
    .join(" ");
  return [
    "Starter profile placeholders must be replaced before this config can run.",
    details,
    "Copy the starter profile to supervisor.config.json, replace the placeholders, then rerun node dist/index.js doctor --config <supervisor-config-path> or inspect /api/setup-readiness.",
  ].join(" ");
}

export function extractInvalidFieldName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const match = error.message.match(/config field: ([A-Za-z0-9_]+)/);
  return match?.[1] ?? null;
}

export function validateParsedConfig(config: SupervisorConfig): void {
  if ((config.codexModelStrategy === "fixed" || config.codexModelStrategy === "alias") && !config.codexModel) {
    throw new Error(`Missing or invalid config field: codexModel (required when codexModelStrategy=${config.codexModelStrategy})`);
  }
  if (
    config.boundedRepairModelStrategy &&
    (config.boundedRepairModelStrategy === "fixed" || config.boundedRepairModelStrategy === "alias") &&
    !config.boundedRepairModel
  ) {
    throw new Error(
      `Missing or invalid config field: boundedRepairModel (required when boundedRepairModelStrategy=${config.boundedRepairModelStrategy})`,
    );
  }
  if (
    config.localReviewModelStrategy &&
    (config.localReviewModelStrategy === "fixed" || config.localReviewModelStrategy === "alias") &&
    !config.localReviewModel
  ) {
    throw new Error(
      `Missing or invalid config field: localReviewModel (required when localReviewModelStrategy=${config.localReviewModelStrategy})`,
    );
  }
  if (config.localReviewFollowUpRepairEnabled === true && config.localReviewFollowUpIssueCreationEnabled === true) {
    throw new Error(
      "Invalid config field: localReviewFollowUpRepairEnabled (cannot enable same-PR local-review follow-up repair together with localReviewFollowUpIssueCreationEnabled)",
    );
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function tokenizeCommand(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(stripWrappingQuotes) ?? [];
}

function isRepoRelativePathToken(token: string | undefined): token is string {
  if (typeof token !== "string") {
    return false;
  }

  const trimmed = token.trim();
  if (trimmed === "" || trimmed.startsWith("-") || path.isAbsolute(trimmed)) {
    return false;
  }

  return trimmed.startsWith("./") || trimmed.startsWith("../") || /[\\/]/.test(trimmed);
}

function firstRepoRelativeScriptArg(args: string[] | undefined): string | null {
  if (!Array.isArray(args)) {
    return null;
  }

  for (const arg of args) {
    if (arg.startsWith("-")) {
      continue;
    }

    if (isRepoRelativePathToken(arg)) {
      return arg;
    }

    return null;
  }

  return null;
}

export function extractRepoRelativeWorkspacePreparationHelper(
  command: LocalCiCommandConfig | undefined,
): { commandText: string; repoRelativePath: string } | null {
  const commandText = displayLocalCiCommand(command);
  if (commandText === null || !command) {
    return null;
  }

  if (typeof command === "string") {
    const tokens = tokenizeCommand(commandText);
    const firstToken = tokens[0];
    if (isRepoRelativePathToken(firstToken)) {
      return { commandText, repoRelativePath: firstToken };
    }

    if (WORKSPACE_PREPARATION_SCRIPT_RUNNERS.has(firstToken ?? "")) {
      const scriptArg = firstRepoRelativeScriptArg(tokens.slice(1));
      if (scriptArg !== null) {
        return { commandText, repoRelativePath: scriptArg };
      }
    }

    return null;
  }

  if (command.mode === "structured") {
    if (isRepoRelativePathToken(command.executable)) {
      return { commandText, repoRelativePath: command.executable };
    }

    if (WORKSPACE_PREPARATION_SCRIPT_RUNNERS.has(command.executable)) {
      const scriptArg = firstRepoRelativeScriptArg(command.args);
      if (scriptArg !== null) {
        return { commandText, repoRelativePath: scriptArg };
      }
    }

    return null;
  }

  const tokens = tokenizeCommand(command.command);
  const firstToken = tokens[0];
  if (isRepoRelativePathToken(firstToken)) {
    return { commandText, repoRelativePath: firstToken };
  }

  if (WORKSPACE_PREPARATION_SCRIPT_RUNNERS.has(firstToken ?? "")) {
    const scriptArg = firstRepoRelativeScriptArg(tokens.slice(1));
    if (scriptArg !== null) {
      return { commandText, repoRelativePath: scriptArg };
    }
  }

  return null;
}

export function validateWorkspacePreparationCommandForWorktrees(
  config: Pick<SupervisorConfig, "workspacePreparationCommand"> & { repoPath?: string },
): string | null {
  const workspacePreparationCommand = config.workspacePreparationCommand;
  if (!workspacePreparationCommand) {
    return null;
  }

  const helper = extractRepoRelativeWorkspacePreparationHelper(workspacePreparationCommand);
  if (helper === null || typeof config.repoPath !== "string" || config.repoPath.trim() === "") {
    return null;
  }

  const resolvedHelperPath = path.resolve(config.repoPath, helper.repoRelativePath);
  const relativeToRepo = path.relative(config.repoPath, resolvedHelperPath);
  if (
    relativeToRepo === "" ||
    relativeToRepo.startsWith("..") ||
    path.isAbsolute(relativeToRepo)
  ) {
    return `workspacePreparationCommand points at ${helper.repoRelativePath}, but that path does not resolve to a file inside repoPath. Move the helper into the repository and commit it, or switch to a worktree-compatible repo-owned command.`;
  }

  try {
    const stats = fs.statSync(resolvedHelperPath);
    if (!stats.isFile()) {
      return `workspacePreparationCommand points at ${helper.repoRelativePath}, but that path does not resolve to a file inside repoPath. Move the helper into the repository and commit it, or switch to a worktree-compatible repo-owned command.`;
    }
  } catch {
    return `workspacePreparationCommand points at ${helper.repoRelativePath}, but that path does not resolve to a file inside repoPath. Move the helper into the repository and commit it, or switch to a worktree-compatible repo-owned command.`;
  }

  const repoRelativePathForGit = relativeToRepo.split(path.sep).join("/");
  const trackedCheck = spawnSync("git", ["-C", config.repoPath, "ls-files", "--error-unmatch", "--", repoRelativePathForGit], {
    encoding: "utf8",
  });
  if (trackedCheck.status === 0) {
    return null;
  }

  if (trackedCheck.status === 1) {
    return `workspacePreparationCommand points at ${helper.repoRelativePath}, but that path resolves to an untracked helper. Commit the helper so preserved issue worktrees inherit it, or switch to a tracked repo-owned command.`;
  }

  return null;
}

export function buildMissingWorkspacePreparationContractWarning(
  config: Pick<SupervisorConfig, "localCiCommand" | "workspacePreparationCommand">,
): string | null {
  if (displayLocalCiCommand(config.localCiCommand) === null || displayLocalCiCommand(config.workspacePreparationCommand) !== null) {
    return null;
  }

  return MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING;
}
