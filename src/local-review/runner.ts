import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../core/command";
import { buildCodexConfigOverrideArgs, buildCodexExecutionSafetyArgs, resolveCodexExecutionDecision } from "../codex/codex-policy";
import { resolveHostCodexDefaultModel } from "../codex/codex-model-policy";
import { resolveCodexModelCapabilities } from "../codex/codex-model-capabilities";
import { loadRelevantExternalReviewMissPatterns, type ExternalReviewMissPattern } from "../external-review/external-review-misses";
import { reviewDir } from "./artifacts";
import { buildRolePrompt, buildVerifierPrompt, parseRoleFooter, parseVerifierFooter } from "./prompt";
import { reviewerTypeForRole } from "./thresholds";
import {
  type LocalReviewExecutionRouting,
  type LocalReviewFinding,
  type LocalReviewRoleResult,
  type LocalReviewVerifierReport,
} from "./types";
import { type LocalReviewRoleSelection } from "../review-role-detector";
import { type GitHubIssue, type GitHubPullRequest, type SupervisorConfig } from "../core/types";
import { loadRelevantVerifierGuardrails } from "../verifier-guardrails";

function safeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export interface LocalReviewTurnRequest {
  config: SupervisorConfig;
  workspacePath: string;
  role: string;
  outputFileName: string;
  prompt: string;
  executionTarget: "local_review_generic" | "local_review_specialist" | "local_review_verifier";
}

export interface LocalReviewTurnResult {
  exitCode: number;
  rawOutput: string;
  routing: LocalReviewExecutionRouting;
}

export type LocalReviewTurnExecutor = (args: LocalReviewTurnRequest) => Promise<LocalReviewTurnResult>;

export async function runCodexReviewTurn(args: LocalReviewTurnRequest): Promise<LocalReviewTurnResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-review-"));
  const messageFile = path.join(tempDir, args.outputFileName);
  const [hostDefault, capabilities] = await Promise.all([
    resolveHostCodexDefaultModel(args.workspacePath),
    resolveCodexModelCapabilities(args.config.codexBinary, args.workspacePath),
  ]);
  const decision = resolveCodexExecutionDecision(
    args.config,
    "local_review",
    undefined,
    args.executionTarget,
    {
      inheritedModel: hostDefault.model,
      reasoningLevelsByModel: capabilities.reasoningLevelsByModel,
      modelCapabilitySource: capabilities.source,
      modelCapabilityFallbackReason: capabilities.fallbackReason,
    },
  );
  const { policy, modelRouting } = decision;
  const routing: LocalReviewExecutionRouting = {
    target: args.executionTarget,
    model: policy.model,
    modelStrategy: modelRouting.strategy,
    requestedModel: modelRouting.requestedModel,
    effectiveModel: modelRouting.effectiveModel,
    modelRouteSource: modelRouting.source,
    modelFallbackSource: modelRouting.fallbackSource,
    modelCapabilitySource: decision.modelCapabilitySource,
    modelCapabilityFallbackReason: decision.modelCapabilityFallbackReason,
    reasoningEffort: policy.reasoningEffort,
    requestedReasoningEffort: policy.requestedReasoningEffort ?? policy.reasoningEffort,
    reasoningEffortFallbackReason: policy.reasoningEffortFallbackReason ?? null,
  };
  const overrideArgs = buildCodexConfigOverrideArgs(policy);
  const executionSafetyArgs = buildCodexExecutionSafetyArgs(args.config);
  const result = await runCommand(
    args.config.codexBinary,
    [
      "exec",
      ...overrideArgs,
      "--json",
      ...executionSafetyArgs,
      "-C",
      args.workspacePath,
      "-o",
      messageFile,
      args.prompt,
    ],
    {
      cwd: args.workspacePath,
      allowExitCodes: [0, 1],
      env: {
        ...process.env,
        npm_config_yes: "true",
        CI: "1",
      },
      timeoutMs: args.config.codexExecTimeoutMinutes * 60_000,
    },
  );

  let rawOutput = "";
  try {
    rawOutput = (await fs.readFile(messageFile, "utf8")).trim();
  } catch {
    rawOutput = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n").trim();
  }
  await fs.rm(tempDir, { recursive: true, force: true });

  return {
    exitCode: result.exitCode,
    rawOutput,
    routing,
  };
}

export async function runRoleReview(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  role: string;
  alwaysReadFiles: string[];
  onDemandFiles: string[];
  priorMissPatterns: ExternalReviewMissPattern[];
  detectedRoles?: LocalReviewRoleSelection[];
  executeTurn?: LocalReviewTurnExecutor;
}): Promise<LocalReviewRoleResult> {
  const prompt = buildRolePrompt({
    repoSlug: args.config.repoSlug,
    issue: args.issue,
    branch: args.branch,
    workspacePath: args.workspacePath,
    defaultBranch: args.defaultBranch,
    pr: args.pr,
    role: args.role,
    alwaysReadFiles: args.alwaysReadFiles,
    onDemandFiles: args.onDemandFiles,
    confidenceThreshold: args.config.localReviewConfidenceThreshold,
    priorMissPatterns: args.priorMissPatterns,
  });
  const executeTurn = args.executeTurn ?? runCodexReviewTurn;
  const reviewerType = reviewerTypeForRole({ role: args.role, detectedRoles: args.detectedRoles });
  const result = await executeTurn({
    config: args.config,
    workspacePath: args.workspacePath,
    role: args.role,
    outputFileName: `${safeSlug(args.role)}.txt`,
    prompt,
    executionTarget: reviewerType === "generic" ? "local_review_generic" : "local_review_specialist",
  });
  const parsed = parseRoleFooter(args.role, result.rawOutput);

  return {
    role: args.role,
    rawOutput: result.rawOutput,
    exitCode: result.exitCode,
    degraded: result.exitCode !== 0,
    routing: result.routing,
    ...parsed,
  };
}

export async function runVerifierReview(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  findings: LocalReviewFinding[];
  executeTurn?: LocalReviewTurnExecutor;
}): Promise<LocalReviewVerifierReport> {
  const changedFiles = [...new Set(
    args.findings
      .map((finding) => (typeof finding.file === "string" && finding.file.trim() !== "" ? finding.file : null))
      .filter((filePath): filePath is string => Boolean(filePath)),
  )];
  const priorMissPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: reviewDir(args.config, args.issue.number),
    issueNumber: args.issue.number,
    prNumber: args.pr.number,
    branch: args.branch,
    currentHeadSha: args.pr.headRefOid,
    changedFiles,
    limit: 3,
    workspacePath: args.workspacePath,
  });
  const verifierGuardrails = await loadRelevantVerifierGuardrails({
    workspacePath: args.workspacePath,
    changedFiles,
    limit: 3,
  });
  const prompt = buildVerifierPrompt({
    repoSlug: args.config.repoSlug,
    issue: args.issue,
    branch: args.branch,
    workspacePath: args.workspacePath,
    defaultBranch: args.defaultBranch,
    pr: args.pr,
    findings: args.findings,
    priorMissPatterns,
    verifierGuardrails,
  });
  const executeTurn = args.executeTurn ?? runCodexReviewTurn;
  const result = await executeTurn({
    config: args.config,
    workspacePath: args.workspacePath,
    role: "verifier",
    outputFileName: "verifier.txt",
    prompt,
    executionTarget: "local_review_verifier",
  });
  const parsed = parseVerifierFooter(result.rawOutput);

  return {
    role: "verifier",
    rawOutput: result.rawOutput,
    exitCode: result.exitCode,
    degraded: result.exitCode !== 0,
    routing: result.routing,
    verifierGuardrails,
    ...parsed,
  };
}
