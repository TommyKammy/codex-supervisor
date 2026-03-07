import { spawn } from "node:child_process";

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

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const allowExitCodes = options.allowExitCodes ?? [0];

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

    child.on("error", reject);

    if (typeof options.timeoutMs === "number") {
      timeoutHandle = setTimeout(() => {
        const pid = child.pid;
        const timeoutMessage = `Command timed out after ${options.timeoutMs}ms: ${command} ${args.join(" ")}`;
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
      settled = true;
      clearTimers();
      const exitCode = code ?? 1;
      if (!allowExitCodes.includes(exitCode)) {
        reject(
          new Error(
            [
              `Command failed: ${command} ${args.join(" ")}`,
              `exitCode=${exitCode}`,
              stderr.trim(),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }

      resolve({ exitCode, stdout, stderr });
    });
  });
}
