import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command";
import { buildCodexConfigOverrideArgs, resolveCodexExecutionPolicy } from "./codex-policy";
import { loadRelevantExternalReviewMissPatterns, type ExternalReviewMissPattern } from "./external-review-misses";
import { reviewDir } from "./local-review-artifacts";
import { buildRolePrompt, buildVerifierPrompt, parseRoleFooter, parseVerifierFooter } from "./local-review-prompt";
import { type LocalReviewFinding, type LocalReviewRoleResult, type LocalReviewVerifierReport } from "./local-review-types";
import { type GitHubIssue, type GitHubPullRequest, type SupervisorConfig } from "./types";

function safeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function runCodexReviewTurn(args: {
  config: SupervisorConfig;
  workspacePath: string;
  outputFileName: string;
  prompt: string;
}): Promise<{ exitCode: number; rawOutput: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-review-"));
  const messageFile = path.join(tempDir, args.outputFileName);
  const overrideArgs = buildCodexConfigOverrideArgs(resolveCodexExecutionPolicy(args.config, "local_review"));
  const result = await runCommand(
    args.config.codexBinary,
    [
      "exec",
      ...overrideArgs,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
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
  const result = await runCodexReviewTurn({
    config: args.config,
    workspacePath: args.workspacePath,
    outputFileName: `${safeSlug(args.role)}.txt`,
    prompt,
  });
  const parsed = parseRoleFooter(args.role, result.rawOutput);

  return {
    role: args.role,
    rawOutput: result.rawOutput,
    exitCode: result.exitCode,
    degraded: result.exitCode !== 0,
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
}): Promise<LocalReviewVerifierReport> {
  const changedFiles = [...new Set(
    args.findings
      .map((finding) => (typeof finding.file === "string" && finding.file.trim() !== "" ? finding.file : null))
      .filter((filePath): filePath is string => Boolean(filePath)),
  )];
  const priorMissPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: reviewDir(args.config, args.issue.number),
    branch: args.branch,
    currentHeadSha: args.pr.headRefOid,
    changedFiles,
    limit: 3,
    workspacePath: args.workspacePath,
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
  });
  const result = await runCodexReviewTurn({
    config: args.config,
    workspacePath: args.workspacePath,
    outputFileName: "verifier.txt",
    prompt,
  });
  const parsed = parseVerifierFooter(result.rawOutput);

  return {
    role: "verifier",
    rawOutput: result.rawOutput,
    exitCode: result.exitCode,
    degraded: result.exitCode !== 0,
    ...parsed,
  };
}
