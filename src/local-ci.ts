import { runCommand } from "./core/command";
import { FailureContext, SupervisorConfig } from "./core/types";
import { nowIso, truncate } from "./core/utils";

export interface LocalCiGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
}

export type LocalCiCommandRunner = (command: string, workspacePath: string) => Promise<void>;

export async function executeLocalCiCommand(command: string, workspacePath: string): Promise<void> {
  await runCommand("sh", ["-lc", command], {
    cwd: workspacePath,
    env: {
      ...process.env,
      CI: "1",
    },
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
    const detail = truncate(error instanceof Error ? error.message : String(error), 1500) ?? "unknown error";
    const summary = truncate(`Configured local CI command failed ${args.gateLabel}.`, 1000) ?? "Configured local CI command failed.";
    return {
      ok: false,
      failureContext: {
        category: "blocked",
        summary,
        signature: "local-ci-gate-failed",
        command,
        details: [detail],
        url: null,
        updated_at: nowIso(),
      },
    };
  }
}
