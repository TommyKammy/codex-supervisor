import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command";
import { buildCodexConfigOverrideArgs, resolveCodexExecutionPolicy } from "./codex-policy";
import { detectLocalReviewRoles } from "./review-role-detector";
import { GitHubIssue, GitHubPullRequest, SupervisorConfig } from "./types";
import { ensureDir, nowIso, truncate } from "./utils";

export type LocalReviewSeverity = "none" | "low" | "medium" | "high";

type ActionableSeverity = Exclude<LocalReviewSeverity, "none">;

interface ParsedRoleFooter {
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  findings: LocalReviewFinding[];
}

export interface LocalReviewFinding {
  role: string;
  title: string;
  body: string;
  file: string | null;
  start: number | null;
  end: number | null;
  severity: ActionableSeverity;
  confidence: number;
  category: string | null;
  evidence: string | null;
}

export interface LocalReviewRoleResult {
  role: string;
  summary: string;
  recommendation: "ready" | "changes_requested" | "unknown";
  findings: LocalReviewFinding[];
  rawOutput: string;
  exitCode: number;
  degraded: boolean;
}

export interface LocalReviewResult {
  ranAt: string;
  summaryPath: string;
  findingsPath: string;
  summary: string;
  findingsCount: number;
  maxSeverity: LocalReviewSeverity;
  recommendation: "ready" | "changes_requested" | "unknown";
  degraded: boolean;
  rawOutput: string;
}

export function localReviewHasActionableFindings(
  record: Pick<IssueRunRecordLike, "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return (
    record.local_review_head_sha === pr.headRefOid &&
    (
      record.local_review_recommendation !== "ready" ||
      record.local_review_findings_count > 0
    )
  );
}

interface IssueRunRecordLike {
  local_review_head_sha: string | null;
  local_review_findings_count: number;
  local_review_recommendation: "ready" | "changes_requested" | "unknown" | null;
}

interface RolePromptArgs {
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  role: string;
  alwaysReadFiles: string[];
  onDemandFiles: string[];
  confidenceThreshold: number;
}

function safeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function reviewDir(config: SupervisorConfig, issueNumber: number): string {
  return path.join(config.localReviewArtifactDir, safeSlug(config.repoSlug), `issue-${issueNumber}`);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSeverity(value: unknown): ActionableSeverity | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }

  return null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeFinding(role: string, value: unknown): LocalReviewFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? normalizeWhitespace(record.title) : "";
  const body = typeof record.body === "string" ? normalizeWhitespace(record.body) : "";
  const severity = normalizeSeverity(record.severity);
  const confidence = normalizeConfidence(record.confidence);
  if (!title || !body || !severity || confidence === null) {
    return null;
  }

  let start =
    typeof record.start === "number" && Number.isInteger(record.start) && record.start > 0
      ? record.start
      : null;
  let end =
    typeof record.end === "number" && Number.isInteger(record.end) && record.end > 0
      ? record.end
      : start;

  if (start === null && end !== null) {
    start = end;
  }

  return {
    role,
    title,
    body,
    file: typeof record.file === "string" && record.file.trim() !== "" ? record.file.trim() : null,
    start,
    end,
    severity,
    confidence,
    category: typeof record.category === "string" && record.category.trim() !== "" ? record.category.trim() : null,
    evidence: typeof record.evidence === "string" && record.evidence.trim() !== "" ? truncate(record.evidence.trim(), 500) : null,
  };
}

function parseRoleFooter(role: string, output: string): ParsedRoleFooter {
  const summaryMatch = output.match(/Review summary:\s*(.+)/i);
  const recommendationMatch = output.match(/Recommendation:\s*(ready|changes_requested)/i);
  const jsonMatch = output.match(/REVIEW_FINDINGS_JSON_START\s*([\s\S]*?)\s*REVIEW_FINDINGS_JSON_END/i);

  let findings: LocalReviewFinding[] = [];

  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      if (Array.isArray(parsed.findings)) {
        findings = parsed.findings
          .map((item) => normalizeFinding(role, item))
          .filter((item): item is LocalReviewFinding => item !== null);
      }
    } catch {
      findings = [];
    }
  }

  return {
    summary: truncate(summaryMatch?.[1]?.trim() ?? `${role} review completed without a structured summary.`, 500) ?? "",
    recommendation: (recommendationMatch?.[1]?.toLowerCase() as "ready" | "changes_requested" | undefined) ?? "unknown",
    findings,
  };
}

function compareRef(defaultBranch: string): string {
  return `origin/${defaultBranch}...HEAD`;
}

function roleGoal(role: string): string[] {
  switch (role) {
    case "explorer":
      return [
        "- Start with the diff and identify the narrowest set of risky code paths.",
        "- Focus on missing context, hidden coupling, and files that deserve deeper review.",
        "- Report only actionable engineering findings, not generic suggestions.",
      ];
    case "reviewer":
      return [
        "- Focus on correctness, regressions, edge cases, and missing tests in the changed code paths.",
        "- Prefer precise findings tied to a specific file and line whenever possible.",
        "- Ignore style nits unless they could hide a bug or maintenance trap.",
      ];
    case "docs_researcher":
      return [
        "- Open durable memory files only if the diff or issue suggests a workflow, architecture, or policy mismatch.",
        "- Focus on requirements drift, contract mismatches, and contradictions with repo guidance.",
        "- Do not report docs-only wording concerns unless they reveal a code or workflow defect.",
      ];
    case "prisma_postgres_reviewer":
      return [
        "- Focus on Prisma schema, migration SQL, PostgreSQL uniqueness semantics, nullability, and relation invariants.",
        "- Look for places where application code assumes a database guarantee that the schema or migration does not actually enforce.",
        "- Prefer findings around unique indexes, partial indexes, check constraints, nullable uniqueness, and schema/migration drift.",
      ];
    case "migration_invariant_reviewer":
      return [
        "- Focus on persisted-state invariants that should be enforced by the database, not just by application validation.",
        "- Look for invalid row combinations, missing CHECK constraints, unsafe defaults, and migrations that allow data shapes the code treats as impossible.",
        "- Report only concrete invariant gaps that could survive into production data.",
      ];
    case "contract_consistency_reviewer":
      return [
        "- Compare API contracts, TypeScript types, schema fields, docs, and tests for drift.",
        "- Look for dropped required fields, widened enums, missing audit fields, and response shapes that no longer match documented behavior.",
        "- Focus on contract mismatches that can break callers or hide data needed for downstream logic.",
      ];
    case "ui_regression_reviewer":
      return [
        "- Focus on UI or browser-flow regressions suggested by the diff, especially around Playwright-covered surfaces.",
        "- Look for changed selectors, state transitions, form flows, and rendering assumptions that could break existing end-to-end tests.",
        "- Report concrete regressions, not general UX suggestions.",
      ];
    default:
      return [
        `- Operate as a specialized reviewer named ${role}.`,
        "- Focus on concrete, actionable defects in the current diff.",
        "- Keep context narrow and avoid speculative findings.",
      ];
  }
}

function buildRolePrompt(args: RolePromptArgs): string {
  const ref = compareRef(args.defaultBranch);

  return [
    `You are performing a local pre-ready ${args.role} review for ${args.repoSlug}.`,
    `Issue: #${args.issue.number} ${args.issue.title}`,
    `Issue URL: ${args.issue.url}`,
    `PR: #${args.pr.number} ${args.pr.url}`,
    `Branch: ${args.branch}`,
    `Workspace: ${args.workspacePath}`,
    `Compare diff against: ${ref}`,
    "",
    "Goal:",
    ...roleGoal(args.role),
    "",
    "Constraints:",
    "- Do not edit files, do not commit, and do not push.",
    "- Review the current branch only.",
    `- Confidence threshold for actionable findings: ${args.confidenceThreshold.toFixed(2)}.`,
    "- Report only findings that you can justify from the diff and any narrowly targeted reads.",
    "",
    ...(args.alwaysReadFiles.length > 0
      ? [
          "Always-read memory files:",
          ...args.alwaysReadFiles.map((filePath) => `- ${filePath}`),
          "",
          "On-demand durable memory files:",
          ...(args.onDemandFiles.length > 0 ? args.onDemandFiles.map((filePath) => `- ${filePath}`) : ["- none configured"]),
          "",
          "Memory policy:",
          "- Read the always-read files first.",
          "- Use the context index to decide whether any on-demand file is worth opening.",
          "- Do not bulk-read every durable memory file just because multiple reviewer roles exist.",
          "- Keep this role narrow: diff first, then the smallest number of targeted file reads.",
          "",
        ]
      : []),
    "Suggested commands:",
    `- git diff --stat ${ref}`,
    `- git diff ${ref}`,
    "",
    "Respond with a concise review and end with this exact footer:",
    "Review summary: <short summary>",
    "Recommendation: <ready|changes_requested>",
    "REVIEW_FINDINGS_JSON_START",
    '{"findings":[{"title":"short label","body":"one-paragraph explanation","file":"path/or/null","start":10,"end":12,"severity":"low|medium|high","confidence":0.0,"category":"optional short tag","evidence":"optional short supporting detail"}]}',
    "REVIEW_FINDINGS_JSON_END",
    "",
    "Return an empty findings array when you have no actionable findings.",
  ].join("\n");
}

function severityWeight(severity: ActionableSeverity): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function dedupeFindings(findings: LocalReviewFinding[]): LocalReviewFinding[] {
  const deduped = new Map<string, LocalReviewFinding>();
  for (const finding of findings) {
    const key = [
      finding.file ?? "",
      finding.start ?? "",
      finding.end ?? "",
      finding.title.toLowerCase(),
      finding.body.toLowerCase(),
    ].join("|");
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, finding);
      continue;
    }

    if (
      severityWeight(finding.severity) > severityWeight(existing.severity) ||
      (severityWeight(finding.severity) === severityWeight(existing.severity) && finding.confidence > existing.confidence)
    ) {
      deduped.set(key, finding);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.confidence - left.confidence;
  });
}

function maxSeverity(findings: LocalReviewFinding[]): LocalReviewSeverity {
  if (findings.some((finding) => finding.severity === "high")) {
    return "high";
  }
  if (findings.some((finding) => finding.severity === "medium")) {
    return "medium";
  }
  if (findings.some((finding) => finding.severity === "low")) {
    return "low";
  }

  return "none";
}

function summarizeRoles(roleResults: LocalReviewRoleResult[]): string {
  const summaries = roleResults
    .map((result) => `- ${result.role}: ${result.summary}`)
    .slice(0, 10);

  return summaries.length > 0
    ? summaries.join("\n")
    : "- local review completed without structured role summaries.";
}

function renderLines(finding: LocalReviewFinding): string {
  if (finding.start == null) {
    return "?";
  }

  return finding.end && finding.end !== finding.start
    ? `${finding.start}-${finding.end}`
    : `${finding.start}`;
}

async function runRoleReview(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  role: string;
  alwaysReadFiles: string[];
  onDemandFiles: string[];
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
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-review-"));
  const messageFile = path.join(tempDir, `${safeSlug(args.role)}.txt`);
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

  const parsed = parseRoleFooter(args.role, rawOutput);
  return {
    role: args.role,
    rawOutput,
    exitCode: result.exitCode,
    degraded: result.exitCode !== 0,
    ...parsed,
  };
}

export function shouldRunLocalReview(
  config: SupervisorConfig,
  record: { local_review_head_sha: string | null },
  pr: GitHubPullRequest,
): boolean {
  return (
    config.localReviewEnabled &&
    (pr.isDraft || config.localReviewPolicy === "block_merge") &&
    record.local_review_head_sha !== pr.headRefOid
  );
}

export async function runLocalReview(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  alwaysReadFiles: string[];
  onDemandFiles: string[];
}): Promise<LocalReviewResult> {
  const roles =
    args.config.localReviewRoles.length > 0
      ? args.config.localReviewRoles
      : args.config.localReviewAutoDetect
        ? await detectLocalReviewRoles(args.config)
        : ["reviewer", "explorer"];
  const roleResults: LocalReviewRoleResult[] = new Array(roles.length);
  const concurrency = Math.min(2, roles.length);
  let currentIndex = 0;

  async function runNextRole(): Promise<void> {
    while (true) {
      const index = currentIndex;
      if (index >= roles.length) {
        return;
      }
      currentIndex += 1;
      roleResults[index] = await runRoleReview({
        ...args,
        role: roles[index],
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runNextRole()));

  const allFindings = roleResults.flatMap((result) => result.findings);
  const actionableFindings = dedupeFindings(
    allFindings.filter((finding) => finding.confidence >= args.config.localReviewConfidenceThreshold),
  );
  const degraded = roleResults.some((result) => result.degraded);
  const aggregateSummary = truncate(
    `Roles run: ${roles.join(", ")}. Actionable findings above confidence ${args.config.localReviewConfidenceThreshold.toFixed(2)}: ${actionableFindings.length}. Degraded roles: ${roleResults.filter((result) => result.degraded).length}.`,
    500,
  ) ?? "";
  const aggregateRecommendation: LocalReviewResult["recommendation"] =
    degraded ? "unknown" : actionableFindings.length > 0 ? "changes_requested" : "ready";
  const ranAt = nowIso();
  const dirPath = reviewDir(args.config, args.issue.number);
  await ensureDir(dirPath);

  const baseName = `head-${args.pr.headRefOid.slice(0, 12)}`;
  const summaryPath = path.join(dirPath, `${baseName}.md`);
  const findingsPath = path.join(dirPath, `${baseName}.json`);
  const rawOutput = roleResults
    .map((result) => `## ${result.role}\n\n${result.rawOutput}`)
    .join("\n\n");

  await fs.writeFile(
    summaryPath,
    [
      `# Local Review for Issue #${args.issue.number}`,
      "",
      `- PR: ${args.pr.url}`,
      `- Branch: ${args.branch}`,
      `- Head SHA: ${args.pr.headRefOid}`,
      `- Ran at: ${ranAt}`,
      `- Roles: ${roles.join(", ")}`,
      `- Confidence threshold: ${args.config.localReviewConfidenceThreshold.toFixed(2)}`,
      `- Actionable findings: ${actionableFindings.length}`,
      `- Max severity: ${maxSeverity(actionableFindings)}`,
      `- Recommendation: ${aggregateRecommendation}`,
      `- Degraded: ${degraded ? "yes" : "no"}`,
      "",
      "## Role summaries",
      summarizeRoles(roleResults),
      "",
      "## Actionable findings",
      ...(actionableFindings.length > 0
        ? actionableFindings.map((finding, index) =>
            [
              `### ${index + 1}. ${finding.title}`,
              `- Role: ${finding.role}`,
              `- Severity: ${finding.severity}`,
              `- Confidence: ${finding.confidence.toFixed(2)}`,
              `- File: ${finding.file ?? "none"}`,
              `- Lines: ${renderLines(finding)}`,
              `- Category: ${finding.category ?? "none"}`,
              `- Body: ${finding.body}`,
              ...(finding.evidence ? [`- Evidence: ${finding.evidence}`] : []),
              "",
            ].join("\n"),
          )
        : ["- No actionable findings above the confidence threshold.", ""]),
      "## Raw role outputs",
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
        confidenceThreshold: args.config.localReviewConfidenceThreshold,
        roles,
        summary: aggregateSummary,
        recommendation: aggregateRecommendation,
        degraded,
        findingsCount: actionableFindings.length,
        maxSeverity: maxSeverity(actionableFindings),
        actionableFindings,
        roleReports: roleResults.map((result) => ({
          role: result.role,
          exitCode: result.exitCode,
          degraded: result.degraded,
          summary: result.summary,
          recommendation: result.recommendation,
          findings: result.findings,
        })),
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
    summary: aggregateSummary,
    findingsCount: actionableFindings.length,
    maxSeverity: maxSeverity(actionableFindings),
    recommendation: aggregateRecommendation,
    degraded,
    rawOutput,
  };
}
