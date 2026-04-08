import path from "node:path";
import { readJsonIfExists } from "../core/utils";
import type { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";
import type { LocalReviewArtifact } from "../local-review/types";
import { reviewDecisionAllowsSamePrManualReviewRepair } from "../review-handling";
import { displayRelativeArtifactPath, localReviewHeadStatus, localReviewIsGating } from "./supervisor-status-summary-helpers";

export interface SupervisorPreMergeEvaluationDto {
  status: "pending" | "passed" | "blocked" | "follow_up_eligible";
  outcome: LocalReviewArtifact["finalEvaluation"]["outcome"] | null;
  repair?:
    | "none"
    | "same_pr_follow_up_current_head"
    | "same_pr_manual_review_current_head"
    | "high_severity_retry_current_head"
    | "manual_review_required";
  reason: string;
  headStatus: "none" | "current" | "stale" | "unknown";
  summaryPath: string | null;
  artifactPath: string | null;
  ranAt: string | null;
  mustFixCount: number;
  manualReviewCount: number;
  followUpCount: number;
}

function localReviewArtifactPath(summaryPath: string | null): string | null {
  if (!summaryPath || path.extname(summaryPath) !== ".md") {
    return null;
  }

  return `${summaryPath.slice(0, -3)}.json`;
}

function pendingReason(headStatus: SupervisorPreMergeEvaluationDto["headStatus"], gating: boolean): string | null {
  if (headStatus === "stale") {
    return "awaiting_current_head_local_review";
  }
  if (headStatus === "none") {
    return gating ? "awaiting_local_review_run" : null;
  }
  if (headStatus === "unknown") {
    return "awaiting_current_head_local_review";
  }
  return null;
}

function blockedReason(artifact: LocalReviewArtifact): string {
  if (artifact.finalEvaluation.outcome === "manual_review_blocked") {
    return `manual_review_residuals=${artifact.finalEvaluation.manualReviewCount}`;
  }
  return `must_fix_residuals=${artifact.finalEvaluation.mustFixCount}`;
}

function outcomeStatus(outcome: LocalReviewArtifact["finalEvaluation"]["outcome"]): SupervisorPreMergeEvaluationDto["status"] {
  if (outcome === "mergeable") {
    return "passed";
  }
  if (outcome === "follow_up_eligible") {
    return "follow_up_eligible";
  }
  return "blocked";
}

function outcomeReason(artifact: LocalReviewArtifact): string {
  switch (artifact.finalEvaluation.outcome) {
    case "mergeable":
      return "residual_findings=0";
    case "follow_up_eligible":
      return `follow_up_candidates=${artifact.finalEvaluation.followUpCount}`;
    case "manual_review_blocked":
    case "fix_blocked":
      return blockedReason(artifact);
  }
}

function repairDisposition(args: {
  config: Pick<
    SupervisorConfig,
    "localReviewFollowUpRepairEnabled" | "localReviewManualReviewRepairEnabled" | "localReviewHighSeverityAction"
  >;
  record: Pick<IssueRunRecord, "state" | "pre_merge_follow_up_count" | "pre_merge_manual_review_count">;
  pr: Pick<GitHubPullRequest, "reviewDecision" | "configuredBotTopLevelReviewStrength"> | null;
  headStatus: SupervisorPreMergeEvaluationDto["headStatus"];
  artifact: LocalReviewArtifact | null;
}): SupervisorPreMergeEvaluationDto["repair"] {
  if (!args.artifact) {
    return "none";
  }

  if (args.artifact.finalEvaluation.outcome === "manual_review_blocked") {
    if (
      args.headStatus === "current" &&
      args.record.state === "local_review_fix" &&
      args.config.localReviewManualReviewRepairEnabled === true &&
      args.pr !== null &&
      reviewDecisionAllowsSamePrManualReviewRepair(args.pr) &&
      (args.record.pre_merge_manual_review_count ?? args.artifact.finalEvaluation.manualReviewCount) > 0
    ) {
      return "same_pr_manual_review_current_head";
    }
    return "manual_review_required";
  }

  if (args.headStatus !== "current" || args.record.state !== "local_review_fix") {
    return "none";
  }

  if (
    args.artifact.finalEvaluation.outcome === "follow_up_eligible" &&
    args.config.localReviewFollowUpRepairEnabled === true &&
    (args.record.pre_merge_follow_up_count ?? args.artifact.finalEvaluation.followUpCount) > 0
  ) {
    return "same_pr_follow_up_current_head";
  }

  if (
    args.artifact.finalEvaluation.outcome === "fix_blocked" &&
    args.config.localReviewHighSeverityAction === "retry"
  ) {
    return "high_severity_retry_current_head";
  }

  return "none";
}

export async function loadPreMergeEvaluationDto(args: {
  config: SupervisorConfig;
  record: Pick<
    IssueRunRecord,
    | "state"
    | "local_review_summary_path"
    | "local_review_run_at"
    | "local_review_head_sha"
    | "local_review_findings_count"
    | "local_review_recommendation"
  >;
  pr: GitHubPullRequest | null;
}): Promise<SupervisorPreMergeEvaluationDto | null> {
  const headStatus = localReviewHeadStatus(args.record, args.pr);
  const gating = localReviewIsGating(args.config, args.record, args.pr);
  const summaryPath = args.record.local_review_summary_path
    ? displayRelativeArtifactPath(args.config, args.record.local_review_summary_path)
    : null;
  const artifactPath = localReviewArtifactPath(args.record.local_review_summary_path);
  const displayedArtifactPath = artifactPath ? displayRelativeArtifactPath(args.config, artifactPath) : null;

  const pending = pendingReason(headStatus, gating);
  if (pending) {
    return {
      status: "pending",
      outcome: null,
      repair: "none",
      reason: pending,
      headStatus,
      summaryPath,
      artifactPath: displayedArtifactPath,
      ranAt: args.record.local_review_run_at,
      mustFixCount: 0,
      manualReviewCount: 0,
      followUpCount: 0,
    };
  }

  if (!artifactPath) {
    return null;
  }

  const artifact = await readJsonIfExists<LocalReviewArtifact>(artifactPath);
  if (!artifact) {
    if (!gating) {
      return null;
    }
    return {
      status: "pending",
      outcome: null,
      repair: "none",
      reason: "awaiting_final_evaluation_artifact",
      headStatus,
      summaryPath,
      artifactPath: displayedArtifactPath,
      ranAt: args.record.local_review_run_at,
      mustFixCount: 0,
      manualReviewCount: 0,
      followUpCount: 0,
    };
  }

  return {
    status: outcomeStatus(artifact.finalEvaluation.outcome),
    outcome: artifact.finalEvaluation.outcome,
    repair: repairDisposition({
      config: args.config,
      record: args.record,
      pr: args.pr,
      headStatus,
      artifact,
    }),
    reason: outcomeReason(artifact),
    headStatus,
    summaryPath,
    artifactPath: displayedArtifactPath,
    ranAt: artifact.ranAt,
    mustFixCount: artifact.finalEvaluation.mustFixCount,
    manualReviewCount: artifact.finalEvaluation.manualReviewCount,
    followUpCount: artifact.finalEvaluation.followUpCount,
  };
}

export function formatPreMergeEvaluationStatusLine(
  evaluation: SupervisorPreMergeEvaluationDto | null,
): string | null {
  if (!evaluation) {
    return null;
  }

  return [
    "pre_merge_evaluation",
    `status=${evaluation.status}`,
    `outcome=${evaluation.outcome ?? "none"}`,
    `repair=${evaluation.repair ?? "none"}`,
    `head=${evaluation.headStatus}`,
    `must_fix=${evaluation.mustFixCount}`,
    `manual_review=${evaluation.manualReviewCount}`,
    `follow_up=${evaluation.followUpCount}`,
    `reason=${evaluation.reason}`,
    `ran_at=${evaluation.ranAt ?? "none"}`,
    `summary_path=${evaluation.summaryPath ?? "none"}`,
    `artifact_path=${evaluation.artifactPath ?? "none"}`,
  ].join(" ");
}
