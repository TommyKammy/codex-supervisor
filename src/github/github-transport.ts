import { CommandOptions, CommandResult, renderCommandSummary, runCommand } from "../core/command";
import { truncate } from "../core/utils";

const TRANSIENT_GITHUB_RETRY_LIMIT = 2;
const TRANSIENT_GITHUB_RETRY_BASE_DELAY_MS = 200;
const DEFAULT_GITHUB_TRANSPORT_TIMEOUT_MS = 60_000;

export type GitHubCommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientGitHubCommandFailure(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const lower = message.toLowerCase();
  const githubRelated =
    lower.includes("api.github.com") ||
    lower.includes("github.com") ||
    lower.includes("graphql") ||
    lower.includes("gh ");
  const transientSignal =
    lower.includes("connection reset by peer") ||
    lower.includes("unexpected eof") ||
    lower.includes("eof") ||
    lower.includes("tls handshake timeout") ||
    lower.includes("i/o timeout") ||
    lower.includes("timeout awaiting response headers") ||
    lower.includes("temporary failure in name resolution") ||
    lower.includes("no such host") ||
    lower.includes("connection refused") ||
    lower.includes("network is unreachable") ||
    lower.includes("server closed idle connection") ||
    lower.includes("http2: client connection lost") ||
    lower.includes("stream error") ||
    lower.includes("internal server error") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable") ||
    lower.includes("gateway timeout");

  return githubRelated && transientSignal;
}

function sanitizeGhCommandMessage(message: string, args: string[]): string {
  const commandSummary = renderCommandSummary("gh", args);
  return message
    .split("\n")
    .map((line) => {
      if (line.startsWith("Command failed: gh ")) {
        return `Command failed: ${commandSummary}`;
      }

      if (line.startsWith("Command timed out: gh ")) {
        return `Command timed out: ${commandSummary}`;
      }

      const timedOutAfterMarker = ": gh ";
      if (line.startsWith("Command timed out after ") && line.includes(timedOutAfterMarker)) {
        return `${line.slice(0, line.indexOf(timedOutAfterMarker) + 2)}${commandSummary}`;
      }

      return line;
    })
    .join("\n");
}

export class GitHubTransport {
  constructor(
    private readonly commandRunner: GitHubCommandRunner = runCommand,
    private readonly delay: (ms: number) => Promise<void> = sleep,
  ) {}

  async run(args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    let lastTransientMessage: string | null = null;
    const commandSummary = renderCommandSummary("gh", args);
    const commandOptions =
      typeof options.timeoutMs === "number"
        ? options
        : { ...options, timeoutMs: DEFAULT_GITHUB_TRANSPORT_TIMEOUT_MS };

    for (let attempt = 0; attempt <= TRANSIENT_GITHUB_RETRY_LIMIT; attempt += 1) {
      try {
        const result = await this.commandRunner("gh", args, commandOptions);
        if (result.exitCode === 0 || !isTransientGitHubCommandFailure(`${result.stderr}\n${result.stdout}`)) {
          return result;
        }

        lastTransientMessage = truncate(
          [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"),
          500,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isTransientGitHubCommandFailure(message)) {
          throw error;
        }

        lastTransientMessage = truncate(sanitizeGhCommandMessage(message, args), 500);
      }

      const nextAttempt = attempt + 1;
      if (nextAttempt > TRANSIENT_GITHUB_RETRY_LIMIT) {
        break;
      }

      console.warn(`Transient GitHub CLI failure for ${commandSummary}; retry ${nextAttempt}/${TRANSIENT_GITHUB_RETRY_LIMIT}.`);
      await this.delay(TRANSIENT_GITHUB_RETRY_BASE_DELAY_MS * nextAttempt);
    }

    throw new Error(
      [
        `Transient GitHub CLI failure after ${TRANSIENT_GITHUB_RETRY_LIMIT + 1} attempts: ${commandSummary}`,
        lastTransientMessage ?? "Unknown transient GitHub failure.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}
