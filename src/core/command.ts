import { spawn } from "node:child_process";

const COMMAND_ERROR_STDERR_LIMIT = 500;
const COMMAND_OUTPUT_CAPTURE_LIMIT = 64 * 1024;
const OUTPUT_TRUNCATION_MARKER = "\n...\n";

export interface CommandOptions {
  cwd?: string;
  allowExitCodes?: number[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdoutCaptureLimitBytes?: number | null;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CommandExecutionError extends Error {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(message: string, args: { exitCode: number; stdout: string; stderr: string; timedOut: boolean }) {
    super(message);
    this.name = "CommandExecutionError";
    this.exitCode = args.exitCode;
    this.stdout = args.stdout;
    this.stderr = args.stderr;
    this.timedOut = args.timedOut;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function truncatePreservingEnds(value: string, limit: number): string {
  if (limit <= 0) {
    return "";
  }

  if (value.length <= limit) {
    return value;
  }

  if (limit <= OUTPUT_TRUNCATION_MARKER.length) {
    return OUTPUT_TRUNCATION_MARKER.slice(0, limit);
  }

  const availableLength = limit - OUTPUT_TRUNCATION_MARKER.length;
  const prefixLength = Math.ceil(availableLength / 2);
  const suffixLength = Math.floor(availableLength / 2);
  return `${value.slice(0, prefixLength)}${OUTPUT_TRUNCATION_MARKER}${suffixLength > 0 ? value.slice(-suffixLength) : ""}`;
}

function formatCommandErrorStderr(stderr: string): string | null {
  const trimmed = stderr.trim();
  if (trimmed === "") {
    return null;
  }

  if (trimmed.length <= COMMAND_ERROR_STDERR_LIMIT) {
    return trimmed;
  }

  const timeoutSummaryMatch = trimmed.match(/Command timed out after [^\n]+/);
  if (timeoutSummaryMatch) {
    const timeoutSummary = truncatePreservingEnds(
      timeoutSummaryMatch[0],
      Math.max(COMMAND_ERROR_STDERR_LIMIT - OUTPUT_TRUNCATION_MARKER.length * 2, 0),
    );
    const availableLength = Math.max(
      COMMAND_ERROR_STDERR_LIMIT - timeoutSummary.length - OUTPUT_TRUNCATION_MARKER.length * 2,
      0,
    );
    const prefixLength = Math.ceil(availableLength / 2);
    const suffixLength = Math.floor(availableLength / 2);
    return `${trimmed.slice(0, prefixLength)}${OUTPUT_TRUNCATION_MARKER}${timeoutSummary}${OUTPUT_TRUNCATION_MARKER}${trimmed.slice(trimmed.length - suffixLength)}`;
  }

  const availableLength = COMMAND_ERROR_STDERR_LIMIT - OUTPUT_TRUNCATION_MARKER.length;
  const prefixLength = Math.ceil(availableLength / 2);
  const suffixLength = Math.floor(availableLength / 2);
  return `${trimmed.slice(0, prefixLength)}${OUTPUT_TRUNCATION_MARKER}${trimmed.slice(trimmed.length - suffixLength)}`;
}

interface BoundedOutputBuffer {
  head: string;
  tail: string;
  truncated: boolean;
}

function createBoundedOutputBuffer(): BoundedOutputBuffer {
  return { head: "", tail: "", truncated: false };
}

function appendBoundedOutput(
  buffer: BoundedOutputBuffer,
  chunk: string,
  limit: number | null = COMMAND_OUTPUT_CAPTURE_LIMIT,
): void {
  if (chunk.length === 0) {
    return;
  }

  if (limit === null) {
    buffer.head += chunk;
    return;
  }

  const currentLength = buffer.head.length + buffer.tail.length;
  if (!buffer.truncated && currentLength + chunk.length <= limit) {
    buffer.head += chunk;
    return;
  }

  const availableLength = Math.max(limit - OUTPUT_TRUNCATION_MARKER.length, 0);
  const headLength = Math.ceil(availableLength / 2);
  const tailLength = Math.floor(availableLength / 2);

  if (!buffer.truncated) {
    const combined = `${buffer.head}${buffer.tail}${chunk}`;
    buffer.head = combined.slice(0, headLength);
    buffer.tail = tailLength > 0 ? combined.slice(combined.length - tailLength) : "";
    buffer.truncated = true;
    return;
  }

  buffer.tail = tailLength > 0 ? `${buffer.tail}${chunk}`.slice(-tailLength) : "";
}

function renderBoundedOutput(buffer: BoundedOutputBuffer): string {
  return buffer.truncated ? `${buffer.head}${OUTPUT_TRUNCATION_MARKER}${buffer.tail}` : buffer.head;
}

function appendRequiredTextPreservingBoundedOutput(renderedOutput: string, requiredText: string): string {
  if (requiredText.length === 0 || renderedOutput.includes(requiredText)) {
    return renderedOutput;
  }

  const separator = renderedOutput.endsWith("\n") || renderedOutput.length === 0 ? "" : "\n";
  if (renderedOutput.length + separator.length + requiredText.length <= COMMAND_OUTPUT_CAPTURE_LIMIT) {
    return `${renderedOutput}${separator}${requiredText}`;
  }

  const boundedRequiredText = truncatePreservingEnds(
    requiredText,
    Math.max(
      COMMAND_OUTPUT_CAPTURE_LIMIT - separator.length - (renderedOutput.length === 0 ? 0 : OUTPUT_TRUNCATION_MARKER.length),
      0,
    ),
  );
  const suffix = `${separator}${boundedRequiredText}`;
  if (renderedOutput.length === 0) {
    return suffix;
  }

  const availableLength = Math.max(COMMAND_OUTPUT_CAPTURE_LIMIT - suffix.length - OUTPUT_TRUNCATION_MARKER.length, 0);
  const headLength = Math.ceil(availableLength / 2);
  const tailLength = Math.floor(availableLength / 2);
  const head = renderedOutput.slice(0, headLength);
  const tail = tailLength > 0 ? renderedOutput.slice(renderedOutput.length - tailLength) : "";

  return `${head}${OUTPUT_TRUNCATION_MARKER}${tail}${suffix}`;
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

    const stdoutBuffer = createBoundedOutputBuffer();
    const stderrBuffer = createBoundedOutputBuffer();
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killHandle: NodeJS.Timeout | undefined;
    let settled = false;
    let timedOut = false;
    let timeoutMessage: string | null = null;

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
      appendBoundedOutput(stdoutBuffer, chunk.toString(), options.stdoutCaptureLimitBytes);
    });

    child.stderr.on("data", (chunk) => {
      appendBoundedOutput(stderrBuffer, chunk.toString());
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
        timeoutMessage = `Command timed out after ${options.timeoutMs}ms: ${commandSummary}`;
        const stderr = renderBoundedOutput(stderrBuffer);
        appendBoundedOutput(
          stderrBuffer,
          `${stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n"}${timeoutMessage}\n`,
        );

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
      const stdout = renderBoundedOutput(stdoutBuffer);
      const stderr = timedOut
        ? appendRequiredTextPreservingBoundedOutput(
            renderBoundedOutput(stderrBuffer),
            timeoutMessage ? `${timeoutMessage}\n` : "",
          )
        : renderBoundedOutput(stderrBuffer);
      if (timedOut) {
        settleReject(
          new CommandExecutionError(
            [
              `Command timed out: ${commandSummary}`,
              `exitCode=${exitCode}`,
              formatCommandErrorStderr(stderr),
            ]
              .filter(Boolean)
              .join("\n"),
            { exitCode, stdout, stderr, timedOut: true },
          ),
        );
        return;
      }

      if (!allowExitCodes.includes(exitCode)) {
        settleReject(
          new CommandExecutionError(
            [
              `Command failed: ${commandSummary}`,
              `exitCode=${exitCode}`,
              formatCommandErrorStderr(stderr),
            ]
              .filter(Boolean)
              .join("\n"),
            { exitCode, stdout, stderr, timedOut: false },
          ),
        );
        return;
      }

      settleResolve({ exitCode, stdout, stderr });
    });
  });
}
