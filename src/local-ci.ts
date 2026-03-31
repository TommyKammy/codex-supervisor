import { displayLocalCiCommand } from "./core/config";
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

function buildFailureDetails(error: unknown, executionMode: LocalCiExecutionMode | null): string[] {
  const message =
    truncatePreservingStartAndEnd(error instanceof Error ? error.message : String(error), 1500) ?? "unknown error";
  const outputError = error instanceof Error ? (error as ErrorWithOutput) : null;

  return [
    executionMode ? `execution mode: ${renderExecutionMode(executionMode)}` : null,
    message,
    renderFailureOutput("stdout", outputError?.stdout),
    renderFailureOutput("stderr", outputError?.stderr),
  ].filter((detail): detail is string => detail !== null);
}

function buildWorkspacePreparationSummary(args: {
  failureClass: Exclude<LocalCiFailureClass, "unset_contract">;
  gateLabel: string;
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
    case "non_zero_exit":
      return (
        truncate(
          `Configured workspace preparation command failed ${args.gateLabel}. Remediation target: workspace environment.`,
          1000,
        ) ?? "Configured workspace preparation command failed. Remediation target: workspace environment."
      );
  }
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
  config: Pick<SupervisorConfig, "workspacePreparationCommand">;
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
    const failureClass = classifyLocalCiFailure(error, command.displayCommand);
    const summary = buildWorkspacePreparationSummary({ failureClass, gateLabel: args.gateLabel });
    return {
      ok: false,
      failureContext: {
        category: "blocked",
        summary,
        signature: workspacePreparationFailureSignature(failureClass),
        command: command.displayCommand,
        details: buildFailureDetails(error, command.executionMode),
        url: null,
        updated_at: nowIso(),
      },
    };
  }
}
