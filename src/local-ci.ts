import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { displayLocalCiCommand } from "./core/config";
import {
  extractRepoRelativeWorkspacePreparationHelper,
  findRepoOwnedWorkspacePreparationCandidate,
} from "./core/config";
import { runCommand } from "./core/command";
import {
  FailureContext,
  LocalCiCommandConfig,
  LocalCiExecutionMode,
  LatestLocalCiResult,
  LocalCiFailureClass,
  LocalCiRemediationTarget,
  SupervisorConfig,
} from "./core/types";
import { nowIso, truncate, truncatePreservingStartAndEnd } from "./core/utils";

const LOCAL_CI_COMMAND_TIMEOUT_MS = 5 * 60_000;

export interface LocalCiGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
  latestResult: LatestLocalCiResult | null;
}

export interface WorkspacePreparationGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
}

interface ResolvedLocalCiCommand {
  config: LocalCiCommandConfig;
  displayCommand: string;
  executionMode: LocalCiExecutionMode;
}

export type LocalCiCommandRunner = (command: ResolvedLocalCiCommand, workspacePath: string) => Promise<void>;

type ErrorWithOutput = Error & {
  code?: string;
  stdout?: string;
  stderr?: string;
};

interface RuffFinding {
  filePath: string;
  code: string;
}

const TARGETED_STATIC_ANALYSIS_FILE_PATTERN =
  /(?:^|\/)(?:test|tests|__tests__|scripts)\/.+|(?:^|\/)[^/]+\.(?:test|spec)\.py$/i;

const RUFF_REMEDIATION_HINTS = new Map<string, string>([
  [
    "F821",
    "F821 hint: define or import the symbol explicitly when possible. If a test framework injects it intentionally, use the narrowest inline suppression such as `# noqa: F821 - provided by fixture` on the affected line.",
  ],
  [
    "F402",
    "F402 hint: avoid fixture-local rebinding that shadows imports when you can. If the rebinding is deliberate for a test fixture, suppress only that line with an exact code and rationale such as `# noqa: F402 - fixture rebinding is intentional`.",
  ],
  [
    "RUF059",
    "RUF059 hint: prefer explicit fixture variables or `_` placeholders for intentionally unused unpacked values. If the unpacking is intentional for coverage, use an inline suppression such as `# noqa: RUF059 - fixture unpacking is intentional`.",
  ],
  [
    "S104",
    "S104 hint: bind test servers to `127.0.0.1` or `localhost` when possible. If an integration fixture must bind all interfaces, suppress only that line with an exact code and rationale such as `# noqa: S104 - test fixture requires wildcard bind`.",
  ],
  [
    "S106",
    "S106 hint: prefer fixture/env injection over hardcoded credentials. If a dummy test credential is intentional, suppress only that line with an exact code and rationale such as `# noqa: S106 - dummy fixture credential`.",
  ],
]);

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function configuredCommandMarkers(command: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(stripWrappingQuotes) ?? [];
  const markers = new Set<string>();
  const addMarker = (value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) {
      markers.add(trimmed.toLowerCase());
    }
  };

  addMarker(command);
  addMarker(tokens[0]);

  if ((tokens[0] === "npm" || tokens[0] === "pnpm") && tokens[1] === "run") {
    addMarker(tokens[2]);
  }

  if (tokens[0] === "yarn") {
    if (tokens[1] === "run") {
      addMarker(tokens[2]);
    } else if (tokens[1] && !tokens[1].startsWith("-")) {
      addMarker(tokens[1]);
    }
  }

  return [...markers];
}

function lineMentionsConfiguredCommand(line: string, markers: string[]): boolean {
  const normalizedLine = line.toLowerCase();
  return markers.some((marker) => normalizedLine.includes(marker));
}

function isMissingCommandError(error: unknown, command: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const commandError = error as ErrorWithOutput;
  if (commandError.code === "ENOENT") {
    return true;
  }

  const markers = configuredCommandMarkers(command);
  const lines = [error.message, commandError.stderr, commandError.stdout]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/\r?\n/));

  return lines.some((line) => {
    if (!lineMentionsConfiguredCommand(line, markers)) {
      return false;
    }

    return /\b(command not found|not found|missing script)\b/i.test(line);
  });
}

function isMissingWorkspaceToolchainError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const commandError = error as ErrorWithOutput;
  const lines = [error.message, commandError.stderr, commandError.stdout]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return lines.some((line) => /\bis not installed in this workspace\b/i.test(line));
}

function resolveLocalCiCommand(command: LocalCiCommandConfig | undefined): ResolvedLocalCiCommand | null {
  if (typeof command === "string") {
    const trimmed = command.trim();
    if (trimmed === "") {
      return null;
    }

    return {
      config: trimmed,
      displayCommand: trimmed,
      executionMode: "legacy_shell_string",
    };
  }

  if (!command) {
    return null;
  }

  if (command.mode === "structured") {
    return {
      config: command,
      displayCommand: displayLocalCiCommand(command) ?? command.executable,
      executionMode: "structured",
    };
  }

  return {
    config: command,
    displayCommand: displayLocalCiCommand(command) ?? command.command,
    executionMode: "shell",
  };
}

function isResolvedLocalCiCommand(command: ResolvedLocalCiCommand | LocalCiCommandConfig): command is ResolvedLocalCiCommand {
  return typeof command === "object" && command !== null && "displayCommand" in command && "executionMode" in command;
}

function localCiFailureSignature(failureClass: Exclude<LocalCiFailureClass, "unset_contract">): string {
  return `local-ci-gate-${failureClass}`;
}

function classifyLocalCiFailure(error: unknown, command: string): Exclude<LocalCiFailureClass, "unset_contract"> {
  if (isMissingCommandError(error, command)) {
    return "missing_command";
  }

  if (isMissingWorkspaceToolchainError(error)) {
    return "workspace_toolchain_missing";
  }

  return "non_zero_exit";
}

function remediationTargetForFailureClass(failureClass: LocalCiFailureClass): LocalCiRemediationTarget {
  switch (failureClass) {
    case "missing_command":
      return "supervisor_config";
    case "workspace_toolchain_missing":
      return "workspace_environment";
    case "worktree_helper_missing":
      return "supervisor_config";
    case "non_zero_exit":
      return "repo_owned_command";
    case "unset_contract":
      return "issue_body";
  }
}

function workspacePreparationFailureSignature(
  failureClass: Exclude<LocalCiFailureClass, "unset_contract">,
): string {
  return `workspace-preparation-gate-${failureClass}`;
}

function buildSummary(args: {
  failureClass: LocalCiFailureClass | null;
  gateLabel: string;
  passed: boolean;
}): string {
  if (args.passed) {
    return truncate(`Configured local CI command passed ${args.gateLabel}.`, 1000) ?? "Configured local CI command passed.";
  }

  switch (args.failureClass) {
    case "missing_command":
      return (
        truncate(
          `Configured local CI command is unavailable ${args.gateLabel}. Remediation target: supervisor config.`,
          1000,
        ) ?? "Configured local CI command is unavailable. Remediation target: supervisor config."
      );
    case "workspace_toolchain_missing":
      return (
        truncate(
          `Configured local CI command could not run ${args.gateLabel} because the workspace toolchain is unavailable. Remediation target: workspace environment.`,
          1000,
        ) ??
        "Configured local CI command could not run because the workspace toolchain is unavailable. Remediation target: workspace environment."
      );
    case "non_zero_exit":
      return (
        truncate(
          `Configured local CI command failed ${args.gateLabel}. Remediation target: repo-owned command.`,
          1000,
        ) ?? "Configured local CI command failed. Remediation target: repo-owned command."
      );
    case "unset_contract":
      return (
        truncate(
          `No repo-owned local CI contract is configured ${args.gateLabel}. Remediation target: issue body.`,
          1000,
        ) ?? "No repo-owned local CI contract is configured. Remediation target: issue body."
      );
    default:
      return truncate(`Configured local CI command failed ${args.gateLabel}.`, 1000) ?? "Configured local CI command failed.";
  }
}

function renderExecutionMode(mode: LocalCiExecutionMode): string {
  switch (mode) {
    case "structured":
      return "structured";
    case "shell":
      return "shell";
    case "legacy_shell_string":
      return "legacy shell-string";
  }
}

function renderFailureOutput(label: "stdout" | "stderr", output: string | undefined): string | null {
  if (typeof output !== "string") {
    return null;
  }

  const trimmed = output.trim();
  if (trimmed === "") {
    return null;
  }

  return `${label}:\n${truncatePreservingStartAndEnd(trimmed, 1500) ?? trimmed}`;
}

function collectCommandErrorLines(error: unknown): string[] {
  if (!(error instanceof Error)) {
    return [String(error)];
  }

  const outputError = error as ErrorWithOutput;
  return [error.message, outputError.stdout, outputError.stderr]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/\r?\n/u));
}

function normalizeStaticAnalysisPath(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function collectTargetedRuffFindings(error: unknown): RuffFinding[] {
  const findings = new Map<string, RuffFinding>();
  const linePattern = /^(.+?):\d+(?::\d+)?:\s*([A-Z]+[0-9]{3})\b/u;

  for (const line of collectCommandErrorLines(error)) {
    const match = line.trim().match(linePattern);
    if (!match) {
      continue;
    }

    const rawPath = match[1];
    const code = match[2];
    if (!rawPath || !code) {
      continue;
    }

    const filePath = normalizeStaticAnalysisPath(rawPath);
    if (!TARGETED_STATIC_ANALYSIS_FILE_PATTERN.test(filePath)) {
      continue;
    }

    if (!RUFF_REMEDIATION_HINTS.has(code)) {
      continue;
    }

    findings.set(`${filePath}:${code}`, { filePath, code });
  }

  return [...findings.values()].sort((left, right) => {
    if (left.filePath === right.filePath) {
      return left.code.localeCompare(right.code);
    }
    return left.filePath.localeCompare(right.filePath);
  });
}

function buildTargetedStaticAnalysisGuidance(error: unknown): string[] {
  const findings = collectTargetedRuffFindings(error);
  if (findings.length === 0) {
    return [];
  }

  const codes = [...new Set(findings.map((finding) => finding.code))].sort();
  const paths = [...new Set(findings.map((finding) => finding.filePath))];

  return [
    `ruff/static-analysis hint: changed tests/scripts triggered ${codes.join(", ")} in ${paths.join(", ")}.`,
    "ruff/static-analysis policy: for intentional test fixtures, prefer the narrowest inline suppression with the exact rule code and a short rationale comment instead of broad file-level ignores.",
    ...codes
      .map((code) => RUFF_REMEDIATION_HINTS.get(code))
      .filter((hint): hint is string => typeof hint === "string"),
  ];
}

function buildFailureDetails(error: unknown, executionMode: LocalCiExecutionMode | null): string[] {
  const message =
    truncatePreservingStartAndEnd(error instanceof Error ? error.message : String(error), 1500) ?? "unknown error";
  const outputError = error instanceof Error ? (error as ErrorWithOutput) : null;

  return [
    executionMode ? `execution mode: ${renderExecutionMode(executionMode)}` : null,
    message,
    ...buildTargetedStaticAnalysisGuidance(error),
    renderFailureOutput("stdout", outputError?.stdout),
    renderFailureOutput("stderr", outputError?.stderr),
  ].filter((detail): detail is string => detail !== null);
}

function buildWorkspacePreparationSummary(args: {
  failureClass: Exclude<LocalCiFailureClass, "unset_contract">;
  gateLabel: string;
  helperPath?: string;
  likelyCause?: string | null;
  recommendedCommand?: string | null;
}): string {
  switch (args.failureClass) {
    case "missing_command":
      return (
        truncate(
          `Configured workspace preparation command is unavailable ${args.gateLabel}. Remediation target: workspace environment.`,
          1000,
        ) ?? "Configured workspace preparation command is unavailable. Remediation target: workspace environment."
      );
    case "workspace_toolchain_missing":
      return (
        truncate(
          `Configured workspace preparation command could not run ${args.gateLabel} because the workspace toolchain is unavailable. Remediation target: workspace environment.`,
          1000,
        ) ??
        "Configured workspace preparation command could not run because the workspace toolchain is unavailable. Remediation target: workspace environment."
      );
    case "worktree_helper_missing": {
      const likelyCause = args.likelyCause ? ` ${args.likelyCause}` : "";
      const recommendedCommand = args.recommendedCommand
        ? ` Recommended repo-native command: ${args.recommendedCommand}.`
        : "";
      return (
        truncate(
          `Configured workspace preparation command could not run ${args.gateLabel} because repo-relative helper ${args.helperPath ?? "the configured helper"} is missing from this issue worktree.${likelyCause}${recommendedCommand} Remediation target: supervisor config.`,
          1000,
        ) ??
        "Configured workspace preparation command could not run because a repo-relative helper is missing from this issue worktree. Remediation target: supervisor config."
      );
    }
    case "non_zero_exit":
      return (
        truncate(
          `Configured workspace preparation command failed ${args.gateLabel}. Remediation target: workspace environment.`,
          1000,
        ) ?? "Configured workspace preparation command failed. Remediation target: workspace environment."
      );
  }
}

function isFilePath(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isTrackedRepoFile(repoPath: string, repoRelativePath: string): boolean | null {
  const trackedCheck = spawnSync("git", ["-C", repoPath, "ls-files", "--error-unmatch", "--", repoRelativePath], {
    encoding: "utf8",
  });
  if (trackedCheck.status === 0) {
    return true;
  }

  if (trackedCheck.status === 1) {
    return false;
  }

  return null;
}

function diagnoseMissingWorktreeHelper(args: {
  workspacePreparationCommand: LocalCiCommandConfig | undefined;
  workspacePath: string;
  repoPath?: string;
}): {
  helperPath: string;
  likelyCause: string | null;
  recommendedCommand: string | null;
} | null {
  const helper = extractRepoRelativeWorkspacePreparationHelper(args.workspacePreparationCommand);
  if (helper === null) {
    return null;
  }

  const workspaceHelperPath = path.resolve(args.workspacePath, helper.repoRelativePath);
  if (isFilePath(workspaceHelperPath)) {
    return null;
  }

  const recommendedCommand = findRepoOwnedWorkspacePreparationCandidate(args.repoPath);
  const normalizedRepoPath =
    typeof args.repoPath === "string" && args.repoPath.trim() !== ""
      ? path.resolve(args.repoPath)
      : null;
  const normalizedWorkspacePath = path.resolve(args.workspacePath);
  if (normalizedRepoPath === null || normalizedRepoPath === normalizedWorkspacePath) {
    return {
      helperPath: helper.repoRelativePath,
      likelyCause: null,
      recommendedCommand,
    };
  }

  const repoHelperPath = path.resolve(normalizedRepoPath, helper.repoRelativePath);
  if (!isFilePath(repoHelperPath)) {
    return {
      helperPath: helper.repoRelativePath,
      likelyCause:
        "Likely cause: the configured command depends on a repo-relative helper that this issue worktree does not contain.",
      recommendedCommand,
    };
  }

  const trackedState = isTrackedRepoFile(normalizedRepoPath, helper.repoRelativePath.split(path.sep).join("/"));
  if (trackedState === false) {
    return {
      helperPath: helper.repoRelativePath,
      likelyCause:
        "Likely cause: the helper exists only as an untracked file in the primary checkout, so preserved issue worktrees do not contain it.",
      recommendedCommand,
    };
  }

  return {
    helperPath: helper.repoRelativePath,
    likelyCause:
      "Likely cause: the configured command appears to rely on checkout-local helper state outside the tracked issue worktree contents.",
    recommendedCommand,
  };
}

export async function executeLocalCiCommand(command: ResolvedLocalCiCommand | LocalCiCommandConfig, workspacePath: string): Promise<void> {
  const resolvedCommand = isResolvedLocalCiCommand(command) ? command : resolveLocalCiCommand(command);
  if (!resolvedCommand) {
    throw new Error("Local CI command is not configured.");
  }

  const options = {
    cwd: workspacePath,
    env: {
      ...process.env,
      CI: "1",
    },
    timeoutMs: LOCAL_CI_COMMAND_TIMEOUT_MS,
  };

  if (resolvedCommand.executionMode === "structured") {
    const structuredCommand = resolvedCommand.config as Exclude<LocalCiCommandConfig, string> & {
      mode: "structured";
      executable: string;
      args?: string[];
    };
    await runCommand(structuredCommand.executable, structuredCommand.args ?? [], options);
    return;
  }

  const shellCommand = typeof resolvedCommand.config === "string"
    ? resolvedCommand.config
    : (resolvedCommand.config as { command: string }).command;
  await runCommand("sh", ["-lc", shellCommand], options);
}

export async function runLocalCiGate(args: {
  config: Pick<SupervisorConfig, "localCiCommand">;
  workspacePath: string;
  gateLabel: string;
  runLocalCiCommand?: LocalCiCommandRunner;
}): Promise<LocalCiGateResult> {
  const command = resolveLocalCiCommand(args.config.localCiCommand);
  const ranAt = nowIso();
  if (!command) {
    return {
      ok: true,
      failureContext: null,
      latestResult: {
        outcome: "not_configured",
        summary: buildSummary({ failureClass: "unset_contract", gateLabel: args.gateLabel, passed: false }),
        ran_at: ranAt,
        head_sha: null,
        execution_mode: null,
        failure_class: "unset_contract",
        remediation_target: remediationTargetForFailureClass("unset_contract"),
      },
    };
  }

  try {
    await (args.runLocalCiCommand ?? executeLocalCiCommand)(command, args.workspacePath);
    return {
      ok: true,
      failureContext: null,
      latestResult: {
        outcome: "passed",
        summary: buildSummary({ failureClass: null, gateLabel: args.gateLabel, passed: true }),
        ran_at: ranAt,
        head_sha: null,
        execution_mode: command.executionMode,
        failure_class: null,
        remediation_target: null,
      },
    };
  } catch (error) {
    const failureClass = classifyLocalCiFailure(error, command.displayCommand);
    const summary = buildSummary({ failureClass, gateLabel: args.gateLabel, passed: false });
    return {
      ok: false,
      failureContext: {
        category: "blocked",
        summary,
        signature: localCiFailureSignature(failureClass),
        command: command.displayCommand,
        details: buildFailureDetails(error, command.executionMode),
        url: null,
        updated_at: ranAt,
      },
      latestResult: {
        outcome: "failed",
        summary,
        ran_at: ranAt,
        head_sha: null,
        execution_mode: command.executionMode,
        failure_class: failureClass,
        remediation_target: remediationTargetForFailureClass(failureClass),
      },
    };
  }
}

export async function runWorkspacePreparationGate(args: {
  config: Pick<SupervisorConfig, "workspacePreparationCommand" | "repoPath">;
  workspacePath: string;
  gateLabel: string;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
}): Promise<WorkspacePreparationGateResult> {
  const command = resolveLocalCiCommand(args.config.workspacePreparationCommand);
  if (!command) {
    return {
      ok: true,
      failureContext: null,
    };
  }

  try {
    await (args.runWorkspacePreparationCommand ?? executeLocalCiCommand)(command, args.workspacePath);
    return {
      ok: true,
      failureContext: null,
    };
  } catch (error) {
    const missingHelperDiagnosis = diagnoseMissingWorktreeHelper({
      workspacePreparationCommand: args.config.workspacePreparationCommand,
      workspacePath: args.workspacePath,
      repoPath: args.config.repoPath,
    });
    const failureClass = missingHelperDiagnosis === null
      ? classifyLocalCiFailure(error, command.displayCommand)
      : "worktree_helper_missing";
    const summary = buildWorkspacePreparationSummary({
      failureClass,
      gateLabel: args.gateLabel,
      helperPath: missingHelperDiagnosis?.helperPath,
      likelyCause: missingHelperDiagnosis?.likelyCause ?? null,
      recommendedCommand: missingHelperDiagnosis?.recommendedCommand ?? null,
    });
    return {
      ok: false,
      failureContext: {
        category: "blocked",
        summary,
        signature: workspacePreparationFailureSignature(failureClass),
        command: command.displayCommand,
        details: [
          ...(() => {
            if (failureClass !== "worktree_helper_missing") {
              return [];
            }

            return [
              missingHelperDiagnosis ? `repo-relative helper: ${missingHelperDiagnosis.helperPath}` : null,
              missingHelperDiagnosis?.likelyCause ?? null,
              missingHelperDiagnosis?.recommendedCommand
                ? `recommended repo-native command: ${missingHelperDiagnosis.recommendedCommand}`
                : null,
            ].filter((detail): detail is string => detail !== null);
          })(),
          ...buildFailureDetails(error, command.executionMode),
        ],
        url: null,
        updated_at: nowIso(),
      },
    };
  }
}
