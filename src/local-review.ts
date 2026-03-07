import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command";
import { GitHubIssue, GitHubPullRequest, SupervisorConfig } from "./types";
import { ensureDir, nowIso, truncate } from "./utils";

export type LocalReviewSeverity = "none" | "low" | "medium" | "high";

export interface LocalReviewResult {
  ranAt: string;
  summaryPath: string;
  findingsPath: string;
  summary: string;
  findingsCount: number;
  maxSeverity: LocalReviewSeverity;
  recommendation: "ready" | "changes_requested" | "unknown";
  rawOutput: string;
}

function safeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function reviewDir(config: SupervisorConfig, issueNumber: number): string {
  return path.join(config.localReviewArtifactDir, safeSlug(config.repoSlug), `issue-${issueNumber}`);
}

function parseFooter(output: string): Pick<LocalReviewResult, "summary" | "findingsCount" | "maxSeverity" | "recommendation"> {
  const summaryMatch = output.match(/Review summary:\s*(.+)/i);
  const findingsMatch = output.match(/Findings count:\s*(\d+)/i);
  const severityMatch = output.match(/Max severity:\s*(none|low|medium|high)/i);
  const recommendationMatch = output.match(/Recommendation:\s*(ready|changes_requested)/i);

  return {
    summary: truncate(summaryMatch?.[1]?.trim() ?? "Local review completed without a structured summary.", 500) ?? "",
    findingsCount: findingsMatch ? Number.parseInt(findingsMatch[1], 10) : 0,
    maxSeverity: (severityMatch?.[1]?.toLowerCase() as LocalReviewSeverity | undefined) ?? "none",
    recommendation: (recommendationMatch?.[1]?.toLowerCase() as "ready" | "changes_requested" | undefined) ?? "unknown",
  };
}

export function shouldRunLocalReview(
  config: SupervisorConfig,
  record: { local_review_head_sha: string | null },
  pr: GitHubPullRequest,
): boolean {
  return config.localReviewEnabled && pr.isDraft && record.local_review_head_sha !== pr.headRefOid;
}

export function buildLocalReviewPrompt(args: {
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  roles: string[];
  sharedMemoryFiles: string[];
}): string {
  const compareRef = `origin/${args.defaultBranch}...HEAD`;
  const roleList = args.roles.length > 0 ? args.roles.join(", ") : "reviewer, explorer";

  return [
    `You are performing a local pre-ready review for ${args.repoSlug}.`,
    `Issue: #${args.issue.number} ${args.issue.title}`,
    `Issue URL: ${args.issue.url}`,
    `PR: #${args.pr.number} ${args.pr.url}`,
    `Branch: ${args.branch}`,
    `Workspace: ${args.workspacePath}`,
    `Compare diff against: ${compareRef}`,
    "",
    "Goal:",
    "- Review the current branch before the draft PR is marked ready.",
    "- Focus on correctness, edge cases, config handling, state-machine safety, and tests.",
    "- Do not edit files, do not commit, and do not push.",
    "",
    "Multi-agent guidance:",
    `- If your Codex environment supports specialized sub-agents, use a small PR-review team with roles such as: ${roleList}.`,
    "- If specialized sub-agents are not available, perform the review yourself in a single turn.",
    "",
    ...(args.sharedMemoryFiles.length > 0
      ? [
          "Durable memory files:",
          ...args.sharedMemoryFiles.map((filePath) => `- ${filePath}`),
          "",
        ]
      : []),
    "Suggested commands:",
    `- git diff --stat ${compareRef}`,
    `- git diff ${compareRef}`,
    "",
    "Respond with a concise review and end with this exact footer:",
    "Review summary: <short summary>",
    "Findings count: <integer>",
    "Max severity: <none|low|medium|high>",
    "Recommendation: <ready|changes_requested>",
  ].join("\n");
}

export async function runLocalReview(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  sharedMemoryFiles: string[];
}): Promise<LocalReviewResult> {
  const prompt = buildLocalReviewPrompt({
    repoSlug: args.config.repoSlug,
    issue: args.issue,
    branch: args.branch,
    workspacePath: args.workspacePath,
    defaultBranch: args.defaultBranch,
    pr: args.pr,
    roles: args.config.localReviewRoles,
    sharedMemoryFiles: args.sharedMemoryFiles,
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-review-"));
  const messageFile = path.join(tempDir, "local-review.txt");
  const result = await runCommand(
    args.config.codexBinary,
    [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      args.workspacePath,
      "-o",
      messageFile,
      prompt,
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

  const parsed = parseFooter(rawOutput);
  const ranAt = nowIso();
  const dirPath = reviewDir(args.config, args.issue.number);
  await ensureDir(dirPath);

  const baseName = `head-${args.pr.headRefOid.slice(0, 12)}`;
  const summaryPath = path.join(dirPath, `${baseName}.md`);
  const findingsPath = path.join(dirPath, `${baseName}.json`);

  await fs.writeFile(
    summaryPath,
    [
      `# Local Review for Issue #${args.issue.number}`,
      "",
      `- PR: ${args.pr.url}`,
      `- Branch: ${args.branch}`,
      `- Head SHA: ${args.pr.headRefOid}`,
      `- Ran at: ${ranAt}`,
      `- Findings: ${parsed.findingsCount}`,
      `- Max severity: ${parsed.maxSeverity}`,
      `- Recommendation: ${parsed.recommendation}`,
      "",
      rawOutput,
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    findingsPath,
    `${JSON.stringify(
      {
        issueNumber: args.issue.number,
        prNumber: args.pr.number,
        branch: args.branch,
        headSha: args.pr.headRefOid,
        ranAt,
        ...parsed,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    ranAt,
    summaryPath,
    findingsPath,
    rawOutput,
    ...parsed,
  };
}
