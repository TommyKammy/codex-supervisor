import { spawn } from "node:child_process";

const COMMAND_ERROR_STDERR_LIMIT = 500;
const STDERR_TRUNCATION_MARKER = "\n...\n";

export interface CommandOptions {
  cwd?: string;
  allowExitCodes?: number[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function formatCommandErrorStderr(stderr: string): string | null {
  const trimmed = stderr.trim();
  if (trimmed === "") {
    return null;
  }

  if (trimmed.length <= COMMAND_ERROR_STDERR_LIMIT) {
    return trimmed;
  }

  const availableLength = COMMAND_ERROR_STDERR_LIMIT - STDERR_TRUNCATION_MARKER.length;
  const prefixLength = Math.ceil(availableLength / 2);
  const suffixLength = Math.floor(availableLength / 2);
  return `${trimmed.slice(0, prefixLength)}${STDERR_TRUNCATION_MARKER}${trimmed.slice(trimmed.length - suffixLength)}`;
}

export function renderCommandSummary(command: string, args: string[], visibleArgCount = 2): string {
  const visibleArgs = args.slice(0, visibleArgCount);
  const omittedCount = Math.max(args.length - visibleArgs.length, 0);
  const summary = [command, ...visibleArgs].join(" ");
  return omittedCount > 0 ? `${summary} +${omittedCount} arg${omittedCount === 1 ? "" : "s"}` : summary;
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const allowExitCodes = options.allowExitCodes ?? [0];
  const commandSummary = renderCommandSummary(command, args);

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: typeof options.timeoutMs === "number" && process.platform !== "win32",
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killHandle: NodeJS.Timeout | undefined;
    let settled = false;
    let timedOut = false;

    const settleReject = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      reject(error);
    };

    const settleResolve = (result: CommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      resolve(result);
    };

    const clearTimers = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (killHandle) {
        clearTimeout(killHandle);
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      settleReject(error);
    });

    if (typeof options.timeoutMs === "number") {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }

        timedOut = true;
        const pid = child.pid;
        const timeoutMessage = `Command timed out after ${options.timeoutMs}ms: ${commandSummary}`;
        stderr += `${stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n"}${timeoutMessage}\n`;

        if (pid) {
          try {
            if (process.platform !== "win32") {
              process.kill(-pid, "SIGTERM");
            } else {
              child.kill("SIGTERM");
            }
          } catch {
            child.kill("SIGTERM");
          }
        }

        killHandle = setTimeout(() => {
          if (!settled && pid) {
            try {
              if (process.platform !== "win32") {
                process.kill(-pid, "SIGKILL");
              } else {
                child.kill("SIGKILL");
              }
            } catch {
              child.kill("SIGKILL");
            }
          }
        }, 5_000);
      }, options.timeoutMs);
    }

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (timedOut) {
        settleReject(
          new Error(
            [
              `Command timed out: ${commandSummary}`,
              `exitCode=${exitCode}`,
              formatCommandErrorStderr(stderr),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }

      if (!allowExitCodes.includes(exitCode)) {
        settleReject(
          new Error(
            [
              `Command failed: ${commandSummary}`,
              `exitCode=${exitCode}`,
              formatCommandErrorStderr(stderr),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }

      settleResolve({ exitCode, stdout, stderr });
    });
  });
}
