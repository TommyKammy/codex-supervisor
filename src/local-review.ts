import { detectLocalReviewRoleSelections } from "./review-role-detector";
import { runCommand } from "./command";
import { loadRelevantExternalReviewMissPatterns } from "./external-review-misses";
import { ensureDir, nowIso, truncate } from "./utils";
import { compareRef } from "./local-review-prompt";
import { dedupeFindings, finalizeLocalReview } from "./local-review-finalize";
import { findingMeetsReviewerThreshold, reviewerTypeForRole } from "./local-review-thresholds";
import { reviewDir, writeLocalReviewArtifacts } from "./local-review-artifacts";
import { runRoleReview, runVerifierReview } from "./local-review-runner";
import { GitHubIssue, GitHubPullRequest, SupervisorConfig } from "./types";
import { type FinalizedLocalReview, type LocalReviewResult, type LocalReviewRoleResult, type LocalReviewVerifierReport } from "./local-review-types";

export type {
  ActionableSeverity,
  FinalizedLocalReview,
  LocalReviewArtifact,
  LocalReviewFinding,
  LocalReviewResult,
  LocalReviewRootCauseSummary,
  LocalReviewRoleResult,
  LocalReviewSeverity,
  LocalReviewVerificationFinding,
  LocalReviewVerifierReport,
  ParsedRoleFooter,
  ParsedVerifierFooter,
  VerificationVerdict,
} from "./local-review-types";

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

export const LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY = "degraded local review; inspect the saved artifact";

function formatBlockerLocation(args: { file: string | null; start: number | null; end: number | null }): string | null {
  if (!args.file) {
    return null;
  }
  if (args.start == null) {
    return args.file;
  }

  return args.end != null && args.end !== args.start
    ? `${args.file}:${args.start}-${args.end}`
    : `${args.file}:${args.start}`;
}

export function buildLocalReviewBlockerSummary(
  review: Pick<FinalizedLocalReview, "recommendation" | "degraded" | "maxSeverity" | "rootCauseCount" | "rootCauseSummaries">,
): string | null {
  if (review.recommendation === "ready") {
    return null;
  }
  if (review.degraded) {
    return LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY;
  }

  const primary = review.rootCauseSummaries[0];
  if (!primary) {
    return review.rootCauseCount > 0 || review.maxSeverity !== "none"
      ? `${review.maxSeverity} severity local-review findings`
      : null;
  }

  const location = formatBlockerLocation(primary);
  const extraCount = Math.max(review.rootCauseSummaries.length - 1, 0);
  return truncate(
    [
      primary.severity,
      location,
      primary.summary,
      extraCount > 0 ? `(+${extraCount} more root cause${extraCount === 1 ? "" : "s"})` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" "),
    160,
  );
}

function selectLocalReviewRoles(args: {
  config: SupervisorConfig;
  detectedRoles: Awaited<ReturnType<typeof detectLocalReviewRoleSelections>>;
}): string[] {
  if (args.config.localReviewRoles.length > 0) {
    return args.config.localReviewRoles;
  }
  if (args.detectedRoles.length > 0) {
    return args.detectedRoles.map((selection) => selection.role);
  }

  return ["reviewer", "explorer"];
}

async function runLocalReviewRoles(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  roles: string[];
  alwaysReadFiles: string[];
  onDemandFiles: string[];
  priorMissPatterns: Awaited<ReturnType<typeof loadRelevantExternalReviewMissPatterns>>;
}): Promise<LocalReviewRoleResult[]> {
  const roleResults: LocalReviewRoleResult[] = new Array(args.roles.length);
  const concurrency = Math.min(2, args.roles.length);
  let currentIndex = 0;

  async function runNextRole(): Promise<void> {
    while (true) {
      const index = currentIndex;
      if (index >= args.roles.length) {
        return;
      }
      currentIndex += 1;
      roleResults[index] = await runRoleReview({
        config: args.config,
        issue: args.issue,
        branch: args.branch,
        workspacePath: args.workspacePath,
        defaultBranch: args.defaultBranch,
        pr: args.pr,
        role: args.roles[index]!,
        alwaysReadFiles: args.alwaysReadFiles,
        onDemandFiles: args.onDemandFiles,
        priorMissPatterns: args.priorMissPatterns,
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runNextRole()));
  return roleResults;
}

async function runLocalReviewVerifier(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  roleResults: LocalReviewRoleResult[];
}): Promise<LocalReviewVerifierReport | null> {
  const rawActionableHighSeverityFindings = dedupeFindings(
    args.roleResults
      .flatMap((result) => result.findings)
      .filter((finding) =>
        finding.severity === "high" &&
        findingMeetsReviewerThreshold({
          finding,
          reviewerType: reviewerTypeForRole({ role: finding.role }),
          config: args.config,
        }),
      ),
  );

  if (rawActionableHighSeverityFindings.length === 0) {
    return null;
  }

  return runVerifierReview({
    config: args.config,
    issue: args.issue,
    branch: args.branch,
    workspacePath: args.workspacePath,
    defaultBranch: args.defaultBranch,
    pr: args.pr,
    findings: rawActionableHighSeverityFindings,
  });
}

function formatLocalReviewResult(args: {
  ranAt: string;
  finalized: FinalizedLocalReview;
  artifacts: Pick<LocalReviewResult, "summaryPath" | "findingsPath" | "rawOutput">;
}): LocalReviewResult {
  return {
    ranAt: args.ranAt,
    summaryPath: args.artifacts.summaryPath,
    findingsPath: args.artifacts.findingsPath,
    summary: args.finalized.summary,
    blockerSummary: buildLocalReviewBlockerSummary(args.finalized),
    findingsCount: args.finalized.findingsCount,
    rootCauseCount: args.finalized.rootCauseCount,
    maxSeverity: args.finalized.maxSeverity,
    verifiedFindingsCount: args.finalized.verifiedFindingsCount,
    verifiedMaxSeverity: args.finalized.verifiedMaxSeverity,
    recommendation: args.finalized.recommendation,
    degraded: args.finalized.degraded,
    rawOutput: args.artifacts.rawOutput,
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
  const ref = compareRef(args.defaultBranch);
  const changedFilesResult = await runCommand(
    "git",
    ["diff", "--name-only", ref],
    {
      cwd: args.workspacePath,
      env: process.env,
    },
  );
  const changedFiles = changedFilesResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const priorMissPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: reviewDir(args.config, args.issue.number),
    branch: args.branch,
    currentHeadSha: args.pr.headRefOid,
    changedFiles,
    limit: 3,
    workspacePath: args.workspacePath,
  });
  const detectedRoles =
    args.config.localReviewRoles.length === 0 && args.config.localReviewAutoDetect
      ? await detectLocalReviewRoleSelections(args.config)
      : [];
  const roles = selectLocalReviewRoles({
    config: args.config,
    detectedRoles,
  });
  const roleResults = await runLocalReviewRoles({
    ...args,
    roles,
    priorMissPatterns,
  });
  const ranAt = nowIso();
  const dirPath = reviewDir(args.config, args.issue.number);
  await ensureDir(dirPath);
  const verifierReport = await runLocalReviewVerifier({
    ...args,
    roleResults,
  });
  const finalized = finalizeLocalReview({
    config: args.config,
    issueNumber: args.issue.number,
    prNumber: args.pr.number,
    branch: args.branch,
    headSha: args.pr.headRefOid,
    detectedRoles,
    roleResults,
    verifierReport,
    ranAt,
  });
  const artifacts = await writeLocalReviewArtifacts({
    config: args.config,
    issueNumber: args.issue.number,
    branch: args.branch,
    prUrl: args.pr.url,
    headSha: args.pr.headRefOid,
    roles,
    ranAt,
    finalized,
    roleResults,
    verifierReport,
  });

  return formatLocalReviewResult({
    ranAt,
    finalized,
    artifacts,
  });
}
