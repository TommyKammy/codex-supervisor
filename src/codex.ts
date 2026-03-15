import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command";
import { buildCodexConfigOverrideArgs, resolveCodexExecutionPolicy } from "./codex-policy";
export { extractBlockedReason, extractFailureSignature, extractStateHint } from "./codex-output-parser";
export {
  buildCodexPrompt,
  buildCodexResumePrompt,
  shouldUseCompactResumePrompt,
  type LocalReviewRepairContext,
} from "./codex-prompt";
import { CodexTurnResult, IssueRunRecord, RunState, SupervisorConfig } from "./types";

export async function runCodexTurn(
  config: SupervisorConfig,
  workspacePath: string,
  prompt: string,
  state: RunState,
  record?: Pick<IssueRunRecord, "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"> | null,
  sessionId?: string | null,
): Promise<CodexTurnResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-"));
  const messageFile = path.join(tempDir, "last-message.txt");
  const overrideArgs = buildCodexConfigOverrideArgs(resolveCodexExecutionPolicy(config, state, record));
  const commandArgs = sessionId
    ? [
        "exec",
        "resume",
        ...overrideArgs,
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-o",
        messageFile,
        sessionId,
        prompt,
      ]
    : [
        "exec",
        ...overrideArgs,
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        workspacePath,
        "-o",
        messageFile,
        prompt,
      ];
  const result = await runCommand(
    config.codexBinary,
    commandArgs,
    {
      cwd: workspacePath,
      allowExitCodes: [0, 1],
      env: {
        ...process.env,
        npm_config_yes: "true",
        CI: "1",
      },
      timeoutMs: config.codexExecTimeoutMinutes * 60_000,
    },
  );

  let lastMessage = "";
  try {
    lastMessage = await fs.readFile(messageFile, "utf8");
  } catch {
    lastMessage = "";
  }

  let resolvedSessionId = sessionId ?? null;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as { type?: string; thread_id?: string };
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        resolvedSessionId = event.thread_id;
      }
    } catch {
      continue;
    }
  }

  await fs.rm(tempDir, { recursive: true, force: true });

  return {
    exitCode: result.exitCode,
    sessionId: resolvedSessionId,
    lastMessage: lastMessage.trim(),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}
