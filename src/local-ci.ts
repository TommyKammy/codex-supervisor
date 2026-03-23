import { runCommand } from "./core/command";
import { FailureContext, SupervisorConfig } from "./core/types";
import { nowIso, truncate } from "./core/utils";

const LOCAL_CI_COMMAND_TIMEOUT_MS = 5 * 60_000;

export interface LocalCiGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
}

export type LocalCiCommandRunner = (command: string, workspacePath: string) => Promise<void>;

type ErrorWithOutput = Error & {
  stdout?: string;
  stderr?: string;
};

function renderFailureOutput(label: "stdout" | "stderr", output: string | undefined): string | null {
  if (typeof output !== "string") {
    return null;
  }

  const trimmed = output.trim();
  if (trimmed === "") {
    return null;
  }

  return `${label}:\n${truncate(trimmed, 1500) ?? trimmed}`;
}

function buildFailureDetails(error: unknown): string[] {
  const message = truncate(error instanceof Error ? error.message : String(error), 1500) ?? "unknown error";
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
  if (!command) {
    return { ok: true, failureContext: null };
  }

  try {
    await (args.runLocalCiCommand ?? executeLocalCiCommand)(command, args.workspacePath);
    return { ok: true, failureContext: null };
  } catch (error) {
    const summary = truncate(`Configured local CI command failed ${args.gateLabel}.`, 1000) ?? "Configured local CI command failed.";
    return {
      ok: false,
      failureContext: {
        category: "blocked",
        summary,
        signature: "local-ci-gate-failed",
        command,
        details: buildFailureDetails(error),
        url: null,
        updated_at: nowIso(),
      },
    };
  }
}
