import path from "node:path";
import {
  EXTERNAL_REVIEW_GUARDRAILS_PATH,
  VERIFIER_GUARDRAILS_PATH,
} from "./committed-guardrails";
import { ensureDir, nowIso, truncate } from "./utils";
import { finalizeLocalReview } from "./local-review-finalize";
import { reviewDir, writeLocalReviewArtifacts } from "./local-review-artifacts";
import { runLocalReviewExecution } from "./local-review-execution";
import { type ExternalReviewMissPattern } from "./external-review-misses";
import {
  collectLocalReviewChangedFiles,
  loadLocalReviewExternalReviewContext,
  prepareLocalReviewRoleSelection,
} from "./local-review-preparation";
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

function displayGuardrailArtifactPath(config: SupervisorConfig, filePath: string): string {
  const relativePath = path.relative(config.localReviewArtifactDir, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath
    : path.basename(filePath);
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
  const changedFiles = await collectLocalReviewChangedFiles({
    workspacePath: args.workspacePath,
    defaultBranch: args.defaultBranch,
  });
  const {
    committedExternalReviewPatterns,
    runtimeExternalReviewPatterns,
    priorMissPatterns,
  } = await loadLocalReviewExternalReviewContext({
    config: args.config,
    issue: args.issue,
    branch: args.branch,
    workspacePath: args.workspacePath,
    currentHeadSha: args.pr.headRefOid,
    changedFiles,
  });
  const { detectedRoles, roles } = await prepareLocalReviewRoleSelection({
    config: args.config,
  });
  const { roleResults, verifierReport } = await runLocalReviewExecution({
    ...args,
    roles,
    priorMissPatterns,
  });
  const ranAt = nowIso();
  const dirPath = reviewDir(args.config, args.issue.number);
  await ensureDir(dirPath);
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
    guardrailProvenance: {
      verifier: {
        committedPath:
          (verifierReport?.verifierGuardrails?.length ?? 0) > 0 ? VERIFIER_GUARDRAILS_PATH : null,
        committedCount: verifierReport?.verifierGuardrails?.length ?? 0,
      },
      externalReview: {
        committedPath: committedExternalReviewPatterns.length > 0 ? EXTERNAL_REVIEW_GUARDRAILS_PATH : null,
        committedCount: committedExternalReviewPatterns.length,
        runtimeSources: [...new Set(runtimeExternalReviewPatterns.map((pattern) => pattern.sourceArtifactPath))]
          .sort()
          .map((sourcePath) => ({
            path: displayGuardrailArtifactPath(args.config, sourcePath),
            count: runtimeExternalReviewPatterns.filter((pattern) => pattern.sourceArtifactPath === sourcePath).length,
          })),
      },
    },
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
