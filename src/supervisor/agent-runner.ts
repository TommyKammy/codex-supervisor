import {
  buildCodexPrompt,
  buildCodexResumePrompt,
  extractBlockedReason,
  extractFailureSignature,
  extractStateHint,
  LocalReviewRepairContext,
  runCodexTurn,
} from "../codex";
import { truncate } from "../core/utils";
import type {
  BlockedReason,
  FailureContext,
  FailureKind,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";
import { buildCodexFailureContext, classifyFailure } from "./supervisor-failure-helpers";
import { basename } from "node:path";
import type { ExternalReviewMissContext } from "../external-review/external-review-misses";

export interface AgentRunnerCapabilities {
  supportsResume: boolean;
  supportsStructuredResult: boolean;
}

interface AgentRunnerBaseRequest {
  config: SupervisorConfig;
  workspacePath: string;
  state: RunState;
  record?: Pick<
    IssueRunRecord,
    "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"
  > | null;
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  journalPath: string;
  journalExcerpt?: string | null;
  failureContext?: FailureContext | null;
  previousSummary?: string | null;
  previousError?: string | null;
}

export interface StartAgentTurnContext extends AgentRunnerBaseRequest {
  kind: "start";
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  alwaysReadFiles: string[];
  onDemandMemoryFiles: string[];
  gsdEnabled?: boolean;
  gsdPlanningFiles?: string[];
  localReviewRepairContext?: LocalReviewRepairContext | null;
  externalReviewMissContext?: ExternalReviewMissContext | null;
}

export interface ResumeAgentTurnContext extends AgentRunnerBaseRequest {
  kind: "resume";
  sessionId: string;
}

export type AgentTurnContext = StartAgentTurnContext | ResumeAgentTurnContext;
export type AgentTurnRequest = AgentTurnContext;

export interface AgentTurnStructuredResult {
  summary: string;
  stateHint: RunState | null;
  blockedReason: BlockedReason;
  failureSignature: string | null;
  nextAction: string | null;
  tests: string | null;
}

export interface AgentTurnResult {
  exitCode: number;
  sessionId: string | null;
  supervisorMessage: string;
  stderr: string;
  stdout: string;
  structuredResult: AgentTurnStructuredResult | null;
  failureKind: FailureKind;
  failureContext: FailureContext | null;
}

export interface AgentRunner {
  readonly capabilities: AgentRunnerCapabilities;
  runTurn(context: AgentTurnContext): Promise<AgentTurnResult>;
}

export interface CreateCodexAgentRunnerOptions {
  runCodexTurnImpl?: typeof runCodexTurn;
  classifyFailureImpl?: typeof classifyFailure;
  buildFailureContextImpl?: typeof buildCodexFailureContext;
  probeCapabilitiesImpl?: (config?: SupervisorConfig) => AgentRunnerCapabilities;
  config?: SupervisorConfig;
}

export function detectCodexCliCapabilities(
  config?: Pick<SupervisorConfig, "codexBinary"> | null,
): AgentRunnerCapabilities {
  const binaryName = basename(config?.codexBinary ?? "codex").toLowerCase();
  const looksLikeCodex = binaryName.includes("codex");

  return {
    supportsResume: looksLikeCodex,
    supportsStructuredResult: looksLikeCodex,
  };
}

function extractLabeledValue(message: string, label: string): string | null {
  const match = message.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  if (!match) {
    return null;
  }

  const value = match[1]?.trim();
  if (!value || value.toLowerCase() === "none") {
    return null;
  }

  return value;
}

export function parseAgentTurnStructuredResult(message: string): AgentTurnStructuredResult | null {
  const summary = extractLabeledValue(message, "Summary");
  const stateHint = extractStateHint(message);
  const blockedReason = extractBlockedReason(message);
  const failureSignature = extractFailureSignature(message);
  const tests = extractLabeledValue(message, "Tests");
  const nextAction = extractLabeledValue(message, "Next action");

  if (!summary && !stateHint && !blockedReason && !failureSignature && !tests && !nextAction) {
    return null;
  }

  return {
    summary: summary ?? "",
    stateHint,
    blockedReason,
    failureSignature,
    nextAction,
    tests,
  };
}

function buildCodexExitFailureContext(
  buildFailureContextImpl: typeof buildCodexFailureContext,
  message: string,
  stderr: string,
  stdout: string,
): FailureContext {
  return buildFailureContextImpl(
    "codex",
    "Codex exited non-zero.",
    [truncate([message, stderr, stdout].filter(Boolean).join("\n"), 2000) ?? "Unknown failure output"],
  );
}

function buildCodexPromptForTurn(context: AgentTurnContext): string {
  if (context.kind === "resume") {
    return buildCodexResumePrompt({
      repoSlug: context.repoSlug,
      issue: context.issue,
      branch: context.branch,
      workspacePath: context.workspacePath,
      state: context.state,
      journalPath: context.journalPath,
      journalExcerpt: context.journalExcerpt,
      failureContext: context.failureContext,
      previousSummary: context.previousSummary,
      previousError: context.previousError,
    });
  }

  return buildCodexPrompt({
    repoSlug: context.repoSlug,
    issue: context.issue,
    branch: context.branch,
    workspacePath: context.workspacePath,
    state: context.state,
    pr: context.pr,
    checks: context.checks,
    reviewThreads: context.reviewThreads,
    alwaysReadFiles: context.alwaysReadFiles,
    onDemandMemoryFiles: context.onDemandMemoryFiles,
    gsdEnabled: context.gsdEnabled,
    gsdPlanningFiles: context.gsdPlanningFiles,
    journalPath: context.journalPath,
    journalExcerpt: context.journalExcerpt,
    failureContext: context.failureContext,
    previousSummary: context.previousSummary,
    previousError: context.previousError,
    localReviewRepairContext: context.localReviewRepairContext,
    externalReviewMissContext: context.externalReviewMissContext,
  });
}

export function createCodexAgentRunner(options: CreateCodexAgentRunnerOptions = {}): AgentRunner {
  const runCodexTurnImpl = options.runCodexTurnImpl ?? runCodexTurn;
  const classifyFailureImpl = options.classifyFailureImpl ?? classifyFailure;
  const buildFailureContextImpl = options.buildFailureContextImpl ?? buildCodexFailureContext;
  const capabilities = (options.probeCapabilitiesImpl ?? detectCodexCliCapabilities)(options.config);

  return {
    capabilities,
    async runTurn(context): Promise<AgentTurnResult> {
      try {
        const prompt = buildCodexPromptForTurn(context);
        const result = await runCodexTurnImpl(
          context.config,
          context.workspacePath,
          prompt,
          context.state,
          context.record,
          context.kind === "resume" ? context.sessionId : undefined,
        );
        const structuredResult = parseAgentTurnStructuredResult(result.lastMessage);
        const failureKind: FailureKind = result.exitCode === 0 ? null : "codex_exit";

        return {
          exitCode: result.exitCode,
          sessionId: result.sessionId,
          supervisorMessage: result.lastMessage,
          stderr: result.stderr,
          stdout: result.stdout,
          structuredResult,
          failureKind,
          failureContext:
            failureKind === null
              ? null
              : buildCodexExitFailureContext(
                  buildFailureContextImpl,
                  result.lastMessage,
                  result.stderr,
                  result.stdout,
                ),
        };
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        return {
          exitCode: 1,
          sessionId: context.kind === "resume" ? context.sessionId : null,
          supervisorMessage: "",
          stderr: message,
          stdout: "",
          structuredResult: null,
          failureKind: classifyFailureImpl(message),
          failureContext: buildFailureContextImpl("codex", "Codex turn execution failed.", [
            truncate(message, 2000) ?? "Unknown failure",
          ]),
        };
      }
    },
  };
}
