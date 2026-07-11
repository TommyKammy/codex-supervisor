import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../core/command";
import { buildCodexConfigOverrideArgs, buildCodexExecutionSafetyArgs, resolveCodexExecutionDecision } from "./codex-policy";
import { resolveHostCodexDefaultModel } from "./codex-model-policy";
import { resolveCodexModelCapabilities } from "./codex-model-capabilities";
import { CodexTurnResult, IssueRunRecord, RunState, SupervisorConfig } from "../core/types";

function extractSessionId(stdout: string, sessionId?: string | null): string | null {
  let resolvedSessionId = sessionId ?? null;
  for (const line of stdout.split("\n")) {
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

  return resolvedSessionId;
}

async function readLastMessage(messageFile: string): Promise<string> {
  try {
    return await fs.readFile(messageFile, "utf8");
  } catch {
    return "";
  }
}

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
  try {
    const [hostDefault, capabilities] = await Promise.all([
      resolveHostCodexDefaultModel(workspacePath),
      resolveCodexModelCapabilities(config.codexBinary, workspacePath),
    ]);
    const decision = resolveCodexExecutionDecision(config, state, record, "supervisor", {
      inheritedModel: hostDefault.model,
      reasoningLevelsByModel: capabilities.reasoningLevelsByModel,
      modelCapabilitySource: capabilities.source,
      modelCapabilityFallbackReason: capabilities.fallbackReason,
    });
    const { policy, modelRouting } = decision;
    const routing = {
      target: "supervisor" as const,
      model: policy.model,
      modelStrategy: modelRouting.strategy,
      requestedModel: modelRouting.requestedModel,
      effectiveModel: modelRouting.effectiveModel,
      modelRouteSource: modelRouting.source,
      modelFallbackSource: modelRouting.fallbackSource,
      modelCapabilitySource: decision.modelCapabilitySource,
      modelCapabilityFallbackReason: decision.modelCapabilityFallbackReason,
      requestedReasoningEffort: policy.requestedReasoningEffort ?? policy.reasoningEffort,
      reasoningEffort: policy.reasoningEffort,
      reasoningEffortFallbackReason: policy.reasoningEffortFallbackReason ?? null,
    };
    const overrideArgs = buildCodexConfigOverrideArgs(policy);
    const executionSafetyArgs = buildCodexExecutionSafetyArgs(config);
    const commandArgs = sessionId
      ? [
          "exec",
          "resume",
          ...overrideArgs,
          "--json",
          ...executionSafetyArgs,
          "-o",
          messageFile,
          sessionId,
          prompt,
        ]
      : [
          "exec",
          ...overrideArgs,
          "--json",
          ...executionSafetyArgs,
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

    const lastMessage = await readLastMessage(messageFile);
    const resolvedSessionId = extractSessionId(result.stdout, sessionId);

    return {
      exitCode: result.exitCode,
      sessionId: resolvedSessionId,
      lastMessage: lastMessage.trim(),
      stderr: result.stderr,
      stdout: result.stdout,
      routing,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
