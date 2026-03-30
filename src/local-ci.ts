import { runCommand } from "./core/command";
import {
  FailureContext,
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

export type LocalCiCommandRunner = (command: string, workspacePath: string) => Promise<void>;

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

function localCiFailureSignature(failureClass: Exclude<LocalCiFailureClass, "unset_contract">): string {
  return `local-ci-gate-${failureClass}`;
}

function classifyLocalCiFailure(error: unknown, command: string): Exclude<LocalCiFailureClass, "unset_contract"> {
  return isMissingCommandError(error, command) ? "missing_command" : "non_zero_exit";
}

function remediationTargetForFailureClass(failureClass: LocalCiFailureClass): LocalCiRemediationTarget {
  switch (failureClass) {
    case "missing_command":
      return "supervisor_config";
    case "non_zero_exit":
      return "repo_owned_command";
    case "unset_contract":
      return "issue_body";
  }
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

function buildFailureDetails(error: unknown): string[] {
  const message =
    truncatePreservingStartAndEnd(error instanceof Error ? error.message : String(error), 1500) ?? "unknown error";
  const outputError = error instanceof Error ? (error as ErrorWithOutput) : null;

  return [
    message,
    renderFailureOutput("stdout", outputError?.stdout),
    renderFailureOutput("stderr", outputError?.stderr),
  ].filter((detail): detail is string => detail !== null);
}

export async function executeLocalCiCommand(command: string, workspacePath: string): Promise<void> {
  await runCommand("sh", ["-lc", command], {
    cwd: workspacePath,
    env: {
      ...process.env,
      CI: "1",
    },
    timeoutMs: LOCAL_CI_COMMAND_TIMEOUT_MS,
  });
}

export async function runLocalCiGate(args: {
  config: Pick<SupervisorConfig, "localCiCommand">;
  workspacePath: string;
  gateLabel: string;
  runLocalCiCommand?: LocalCiCommandRunner;
}): Promise<LocalCiGateResult> {
  const command =
    typeof args.config.localCiCommand === "string" && args.config.localCiCommand.trim() !== ""
      ? args.config.localCiCommand.trim()
      : null;
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
        failure_class: null,
        remediation_target: null,
      },
    };
  } catch (error) {
    const failureClass = classifyLocalCiFailure(error, command);
    const summary = buildSummary({ failureClass, gateLabel: args.gateLabel, passed: false });
    return {
      ok: false,
      failureContext: {
        category: "blocked",
        summary,
        signature: localCiFailureSignature(failureClass),
        command,
        details: buildFailureDetails(error),
        url: null,
        updated_at: ranAt,
      },
      latestResult: {
        outcome: "failed",
        summary,
        ran_at: ranAt,
        head_sha: null,
        failure_class: failureClass,
        remediation_target: remediationTargetForFailureClass(failureClass),
      },
    };
  }
}
