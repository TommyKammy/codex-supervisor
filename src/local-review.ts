import {
  formatLocalReviewResult,
  prepareLocalReviewGuardrailProvenance,
} from "./local-review-result";
import { ensureDir, nowIso } from "./utils";
import { finalizeLocalReview } from "./local-review-finalize";
import { reviewDir, writeLocalReviewArtifacts } from "./local-review-artifacts";
import { runLocalReviewExecution } from "./local-review-execution";
import {
  collectLocalReviewChangedFiles,
  loadLocalReviewExternalReviewContext,
  prepareLocalReviewRoleSelection,
} from "./local-review-preparation";
import { GitHubIssue, GitHubPullRequest, SupervisorConfig } from "./types";
import { type LocalReviewResult } from "./local-review-types";

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
export {
  buildLocalReviewBlockerSummary,
  LOCAL_REVIEW_DEGRADED_BLOCKER_SUMMARY,
} from "./local-review-result";

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
    detectedRoles,
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
    guardrailProvenance: prepareLocalReviewGuardrailProvenance({
      config: args.config,
      verifierReport,
      committedExternalReviewPatterns,
      runtimeExternalReviewPatterns,
    }),
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
