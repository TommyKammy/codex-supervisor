import type {
  BlockedReason,
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";
import {
  buildMissingWorkspacePreparationContractWarning,
  MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING,
} from "../core/config";
import { projectTrackedPrLifecycle } from "../tracked-pr-lifecycle-projection";

export interface TrackedPrMismatch {
  issueNumber: number;
  prNumber: number;
  githubState: RunState;
  githubBlockedReason: BlockedReason | null;
  localState: RunState;
  localBlockedReason: BlockedReason | null;
  staleLocalBlocker: boolean;
  summaryLine: string;
  guidanceLine: string;
  detailLines: string[];
}

function isBlockedLikeState(state: RunState): boolean {
  return state === "blocked" || state === "failed";
}

function localCiHeadStatus(record: IssueRunRecord, pr: GitHubPullRequest, result: LatestLocalCiResult): "current" | "stale" | "unknown" {
  const currentHeadSha = pr.headRefOid ?? record.last_head_sha ?? null;
  if (result.head_sha === null || currentHeadSha === null) {
    return "unknown";
  }
  return result.head_sha === currentHeadSha ? "current" : "stale";
}

function summarizeGitHubChecks(checks: PullRequestCheck[], pr: GitHubPullRequest): "green" | "failing" | "pending" | "unknown" {
  if (checks.some((check) => check.bucket === "fail")) {
    return "failing";
  }
  if (checks.some((check) => check.bucket === "pending")) {
    return "pending";
  }
  if (checks.some((check) => check.bucket === "pass") || pr.currentHeadCiGreenAt) {
    return "green";
  }
  return "unknown";
}

function buildTrackedPrHostLocalCiDetailLines(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
): string[] {
  const result = record.latest_local_ci_result ?? null;
  if (record.blocked_reason !== "verification" || result?.outcome !== "failed") {
    return [];
  }

  const detailLines = [
    [
      "tracked_pr_host_local_ci",
      `issue=#${record.issue_number}`,
      `pr=#${pr.number}`,
      `github_checks=${summarizeGitHubChecks(checks, pr)}`,
      `head_sha=${pr.headRefOid}`,
      `outcome=${result.outcome}`,
      `failure_class=${result.failure_class ?? "none"}`,
      `remediation_target=${result.remediation_target ?? "none"}`,
      `head=${localCiHeadStatus(record, pr, result)}`,
      `summary=${result.summary.replace(/\r?\n/g, "\\n")}`,
    ].join(" "),
  ];

  if (result.failure_class === "workspace_toolchain_missing" && !config.workspacePreparationCommand) {
    const warning =
      buildMissingWorkspacePreparationContractWarning(config)
      ?? MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING;
    detailLines.push(
      [
        "tracked_pr_host_local_ci_gap",
        `issue=#${record.issue_number}`,
        `pr=#${pr.number}`,
        "workspace_preparation_command=unset",
        "gap=missing_workspace_prerequisite_visibility",
        `likely_cause=${(warning ?? "missing workspace preparation contract").replace(/\r?\n/g, "\\n")}`,
      ].join(" "),
    );
  }

  return detailLines;
}

export function buildTrackedPrMismatch(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): TrackedPrMismatch | null {
  if (record.pr_number === null) {
    return null;
  }

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks,
    reviewThreads,
  });
  const githubState = projection.nextState;
  const githubBlockedReason = projection.nextBlockedReason;
  const mismatch =
    isBlockedLikeState(record.state) &&
    (githubState !== record.state || (githubState === "blocked" && githubBlockedReason !== record.blocked_reason));

  if (!mismatch) {
    return null;
  }

  const staleLocalBlocker =
    record.blocked_reason !== null &&
    (githubState !== "blocked" || githubBlockedReason !== record.blocked_reason);

  return {
    issueNumber: record.issue_number,
    prNumber: pr.number,
    githubState,
    githubBlockedReason,
    localState: record.state,
    localBlockedReason: record.blocked_reason,
    staleLocalBlocker,
    summaryLine: [
      "tracked_pr_mismatch",
      `issue=#${record.issue_number}`,
      `pr=#${pr.number}`,
      `github_state=${githubState}`,
      `github_blocked_reason=${githubBlockedReason ?? "none"}`,
      `local_state=${record.state}`,
      `local_blocked_reason=${record.blocked_reason ?? "none"}`,
      `stale_local_blocker=${staleLocalBlocker ? "yes" : "no"}`,
    ].join(" "),
    guidanceLine:
      "recovery_guidance=Tracked PR facts are fresher than local state; run the supervisor again to refresh tracked PR state. Explicit requeue is unavailable for tracked PR work.",
    detailLines: buildTrackedPrHostLocalCiDetailLines(config, record, pr, checks),
  };
}
